import { describe, expect, test, vi } from 'vitest'

import {
  DEFAULT_EMAIL,
  makeCreateWorkItemController,
  makeSubmitCreateWorkItemController
} from './controller.js'

function makeH() {
  const captured = { view: null, viewModel: null, code: null, redirect: null }
  const response = {
    code(c) {
      captured.code = c
      return response
    }
  }
  const h = {
    view(view, model) {
      captured.view = view
      captured.viewModel = model
      return response
    },
    redirect(url) {
      captured.redirect = url
      return response
    }
  }
  return { h, captured }
}

function makeRequest({
  payload = {},
  user = { id: 'u-1', email: 'user@example.com' }
} = {}) {
  const flashCalls = []
  return {
    payload,
    auth: { credentials: user },
    yar: {
      flash(name, value) {
        flashCalls.push({ name, value })
      },
      _flashCalls: flashCalls
    }
  }
}

describe('#makeCreateWorkItemController (RA-127, RA-219)', () => {
  test('GET renders the form with the default email and no application reference field', () => {
    const ctl = makeCreateWorkItemController()
    const { h, captured } = makeH()
    ctl.handler(makeRequest(), h)
    expect(captured.view).toBe('re-accreditation/create/index')
    expect(captured.code).toBe(200)
    expect(captured.viewModel.heading).toBe('Create a work item')
    // RA-219: the reference is server-generated; the form never shows it.
    expect(captured.viewModel.values.applicationReference).toBeUndefined()
    expect(captured.viewModel.values.operatorEmail).toBe(DEFAULT_EMAIL)
    expect(captured.viewModel.values.organisationName).toBe(
      'Acme Recycling Ltd'
    )
    expect(captured.viewModel.values.siteAddress).toEqual({
      line1: '12 Industrial Way',
      line2: 'Parkside Estate',
      town: 'Bristol',
      postcode: 'BS1 4DJ'
    })
    // material and tonnageBand demo values should be selected in the dropdowns
    expect(
      captured.viewModel.materialOptions.find((o) => o.value === 'plastic')
        .selected
    ).toBe(true)
    expect(captured.viewModel.materialOptions[0].selected).toBe(false)
    expect(
      captured.viewModel.tonnageBandOptions.find((o) => o.value === '500-5000')
        .selected
    ).toBe(true)
    expect(captured.viewModel.fieldErrors).toEqual({})
    expect(captured.viewModel.errorSummary).toBeNull()
  })

  test('accepts a custom defaultEmail override', () => {
    const ctl = makeCreateWorkItemController({
      defaultEmail: 'override@example.org'
    })
    const { h, captured } = makeH()
    ctl.handler(makeRequest(), h)
    expect(captured.viewModel.values.operatorEmail).toBe('override@example.org')
  })
})

describe('#makeSubmitCreateWorkItemController (RA-127)', () => {
  test('reshapes flat payload, calls service, flashes banner and 302-redirects on success', async () => {
    const service = {
      create: vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'wi-42' },
        applicationReference: 'REF-A'
      })
    }
    const ctl = makeSubmitCreateWorkItemController({ service })
    const request = makeRequest({
      payload: {
        organisationName: 'Acme',
        siteAddressLine1: '1 Road',
        siteAddressLine2: '',
        siteAddressTown: 'Town',
        siteAddressPostcode: 'AB1 2CD',
        material: 'plastic',
        tonnageBand: '500-5000'
      }
    })
    const { h, captured } = makeH()

    await ctl.handler(request, h)

    expect(service.create).toHaveBeenCalledTimes(1)
    const call = service.create.mock.calls[0][0]
    expect(call.user).toEqual({ id: 'u-1', email: 'user@example.com' })
    expect(call.formValues.siteAddress).toEqual({
      line1: '1 Road',
      line2: '',
      town: 'Town',
      postcode: 'AB1 2CD'
    })
    // RA-219: the BFF never sends an application reference to the service.
    expect(call.formValues.applicationReference).toBeUndefined()

    // The reference shown to the user is the one the service returns
    // (sourced from the backend-created work item), flashed verbatim.
    expect(request.yar._flashCalls).toEqual([
      { name: 'successBanner', value: { reference: 'REF-A' } }
    ])
    expect(captured.redirect).toBe('/work-items/wi-42')
  })

  test('falls back to the work item id when the service returns no applicationReference (RA-219 guard)', async () => {
    // Defensive path: the backend always stamps the reference in practice,
    // but if the created work item carries no applicationReference the banner
    // must not show a dangling "Work item created — ". We flash the work
    // item id instead (mirroring decorate()'s applicationRef fallback).
    const service = {
      create: vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'wi-77' },
        applicationReference: undefined
      })
    }
    const ctl = makeSubmitCreateWorkItemController({ service })
    const request = makeRequest()
    const { h, captured } = makeH()

    await ctl.handler(request, h)

    expect(request.yar._flashCalls).toEqual([
      { name: 'successBanner', value: { reference: 'wi-77' } }
    ])
    expect(captured.redirect).toBe('/work-items/wi-77')
  })

  test('suppresses the success banner entirely when neither a reference nor an id is available (RA-219 guard)', async () => {
    // Belt-and-braces: with no reference and no id there is nothing to show,
    // so we flash no banner at all rather than a dangling "Work item created
    // — " one. The redirect still happens (to the bare detail path).
    const service = {
      create: vi.fn().mockResolvedValue({
        ok: true,
        workItem: {},
        applicationReference: undefined
      })
    }
    const ctl = makeSubmitCreateWorkItemController({ service })
    const request = makeRequest()
    const { h, captured } = makeH()

    await ctl.handler(request, h)

    expect(request.yar._flashCalls).toEqual([])
    // No id to redirect to; the existing redirect logic stringifies the
    // missing id. The point of this test is the suppressed banner above.
    expect(captured.redirect).toBe('/work-items/undefined')
  })

  test('encodes the redirect path so weird ids cannot break out', async () => {
    const service = {
      create: vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'a/b c' },
        applicationReference: 'REF-Z'
      })
    }
    const ctl = makeSubmitCreateWorkItemController({ service })
    const { h, captured } = makeH()
    await ctl.handler(makeRequest(), h)
    expect(captured.redirect).toBe('/work-items/a%2Fb%20c')
  })

  test('renders the form with 400 + error summary when the service returns invalid', async () => {
    const service = {
      create: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'invalid',
        fieldErrors: {
          operatorEmail: 'Enter an email address',
          'siteAddress.postcode': 'Enter a valid UK postcode'
        }
      })
    }
    const ctl = makeSubmitCreateWorkItemController({ service })
    const { h, captured } = makeH()

    await ctl.handler(makeRequest(), h)

    expect(captured.view).toBe('re-accreditation/create/index')
    expect(captured.code).toBe(400)
    expect(captured.viewModel.fieldErrors.operatorEmail).toBeDefined()
    expect(captured.viewModel.errorSummary.items).toHaveLength(2)
    // FIELD_ORDER places operatorEmail before siteAddress.postcode
    expect(captured.viewModel.errorSummary.items[0]).toEqual({
      text: 'Enter an email address',
      href: '#field-operatorEmail'
    })
    expect(captured.viewModel.errorSummary.items[1]).toEqual({
      text: 'Enter a valid UK postcode',
      href: '#field-siteAddress-postcode'
    })
    expect(captured.viewModel.pageTitle).toMatch(/^Error:/)
  })

  test('renders 502 with the backend message in the error summary when the backend errors with no field errors', async () => {
    const service = {
      create: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'server',
        message: 'Backend exploded'
      })
    }
    const ctl = makeSubmitCreateWorkItemController({ service })
    const { h, captured } = makeH()

    await ctl.handler(makeRequest(), h)

    expect(captured.code).toBe(502)
    expect(captured.viewModel.errorSummary.items).toEqual([
      { text: 'Backend exploded' }
    ])
    expect(captured.viewModel.topLevelError).toBeUndefined()
  })

  test('renders 400 when the service says invalid but provides no per-field errors', async () => {
    const service = {
      create: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: 'invalid', message: 'Bad' })
    }
    const ctl = makeSubmitCreateWorkItemController({ service })
    const { h, captured } = makeH()
    await ctl.handler(makeRequest(), h)
    expect(captured.code).toBe(400)
    expect(captured.viewModel.errorSummary.items).toEqual([{ text: 'Bad' }])
  })

  test('falls back to a default top-level message when the backend gives none', async () => {
    const service = {
      create: vi.fn().mockResolvedValue({ ok: false, reason: 'network' })
    }
    const ctl = makeSubmitCreateWorkItemController({ service })
    const { h, captured } = makeH()
    await ctl.handler(makeRequest(), h)
    expect(captured.code).toBe(502)
    expect(captured.viewModel.errorSummary.items).toEqual([
      { text: 'Could not create the work item.' }
    ])
  })

  test('uses the default service when none is injected', () => {
    const ctl = makeSubmitCreateWorkItemController()
    expect(typeof ctl.handler).toBe('function')
  })

  test('reshapeFormPayload tolerates an entirely missing payload', async () => {
    const service = {
      create: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'invalid',
        fieldErrors: { operatorEmail: 'Enter an email address' }
      })
    }
    const ctl = makeSubmitCreateWorkItemController({ service })
    const { h, captured } = makeH()
    await ctl.handler({ ...makeRequest(), payload: undefined }, h)
    expect(service.create).toHaveBeenCalledTimes(1)
    expect(service.create.mock.calls[0][0].formValues.siteAddress).toEqual({
      line1: undefined,
      line2: undefined,
      town: undefined,
      postcode: undefined
    })
    expect(captured.code).toBe(400)
  })
})
