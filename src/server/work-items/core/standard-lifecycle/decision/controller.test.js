import { describe, expect, test, vi, beforeEach } from 'vitest'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  getWorkItem: vi.fn()
}))

vi.mock('#/server/common/helpers/auth/get-user.js', () => ({
  getUser: vi.fn(() => ({ id: 'u-1', name: 'Alice' }))
}))

vi.mock('#/server/common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  })
}))

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { reAccreditationType } from '#/server/work-items/re-accreditation/module.js'
import { addOverseasSiteType } from '#/server/work-items/add-overseas-site/module.js'
import { RE_ACCREDITATION_TYPE_ID } from '#/server/work-items/re-accreditation/type-id.js'

import {
  makeShowDecisionController as makeShowStandardDecisionController,
  makeSubmitDecisionController as makeSubmitStandardDecisionController
} from './controller.js'

// RA-495. Exercised through re-accreditation, the first type on the shared
// Standard lifecycle.
const makeShowDecisionController = () =>
  makeShowStandardDecisionController({ typeId: RE_ACCREDITATION_TYPE_ID })
const makeSubmitDecisionController = (options) =>
  makeSubmitStandardDecisionController({
    typeId: RE_ACCREDITATION_TYPE_ID,
    ...options
  })

// Both handlers gate on the module's DECLARED decision transitions, resolved
// through the type registry — so these unit tests register the real type,
// exactly as the plugin does at boot. Registering the REAL declaration (not a
// stub) means a regression in `module.js` fails here too.
beforeEach(() => {
  clearWorkItemRegistry()
  registerWorkItemType(reAccreditationType)
  registerWorkItemType(addOverseasSiteType)
})

const DETAIL_HREF = '/work-items/wi-1'
const DECISION_HREF = '/work-items/re-accreditation/wi-1/decision'

// RA-505. The final crumb mirrors this page's H1 ("Make determination for this
// application"), NOT the "Log decision" CTA on the detail page that navigates
// here — those are deliberately different strings. Asserted on EVERY render of
// the page (initial GET and validation-error re-render) so the two cannot
// drift apart.
const EXPECTED_BREADCRUMBS = [
  { text: 'Work items', href: '/work-items' },
  { text: 'RA-REF-001', href: DETAIL_HREF },
  { text: 'Make determination' }
]

function aDecidableWorkItem(overrides = {}) {
  return {
    id: 'wi-1',
    typeId: 're-accreditation',
    stateId: 'assessment-in-progress',
    payload: { applicationReference: 'RA-REF-001' },
    ...overrides
  }
}

function mockDecidable(overrides = {}) {
  getWorkItem.mockResolvedValue({
    ok: true,
    workItem: aDecidableWorkItem(overrides)
  })
}

function makeToolkit() {
  const view = vi.fn(() => {
    const response = { code: vi.fn(() => response) }
    return response
  })
  return { view, redirect: vi.fn((path) => ({ redirect: path })) }
}

function makeRequest(payload = {}) {
  return {
    params: { id: 'wi-1' },
    payload,
    yar: { flash: vi.fn() }
  }
}

describe('makeShowDecisionController', () => {
  test('renders the radio page for a decidable work item', async () => {
    mockDecidable()
    const h = makeToolkit()

    await makeShowDecisionController().handler(makeRequest(), h)

    expect(h.view).toHaveBeenCalledWith(
      'standard-lifecycle/decision/index',
      expect.objectContaining({
        formAction: DECISION_HREF,
        cancelHref: DETAIL_HREF,
        values: {
          decision: null,
          decisionNote: '',
          effectiveDate: { day: '', month: '', year: '' }
        },
        // Re-accreditation takes no effective date (RA-495 AC6).
        showEffectiveDate: false,
        errorSummary: null,
        breadcrumbs: EXPECTED_BREADCRUMBS
      })
    )
  })

  test('redirects with a banner when the item is not decidable', async () => {
    // Guards the ROUTE, not just the CTA: the URL is guessable and
    // bookmarkable, and the state may have moved on since the detail page
    // was rendered.
    mockDecidable({ stateId: 'submitted' })
    const request = makeRequest()
    const h = makeToolkit()

    await makeShowDecisionController().handler(request, h)

    expect(h.view).not.toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledWith(DETAIL_HREF)
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ type: 'error' })
    )
  })

  test('uses distinct copy for an already-decided item', async () => {
    mockDecidable({ stateId: 'approved' })
    const request = makeRequest()

    await makeShowDecisionController().handler(request, makeToolkit())

    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        text: 'A decision has already been recorded for this application.'
      })
    )
  })

  test('renders the not-found page for a missing work item', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })
    const h = makeToolkit()

    await makeShowDecisionController().handler(makeRequest(), h)

    expect(h.view).toHaveBeenCalledWith(
      'work-items/not-found',
      expect.anything()
    )
  })

  test('renders the unavailable page when the backend is down', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 502, error: 'boom' })
    const h = makeToolkit()

    await makeShowDecisionController().handler(makeRequest(), h)

    expect(h.view).toHaveBeenCalledWith(
      'work-items/detail-error',
      expect.anything()
    )
  })
})

describe('makeSubmitDecisionController', () => {
  // RA-527. Step 1 of an approval: the persistent "Application approved"
  // banner on the detail page replaces the one-time success flash.
  test('records an Approved decision and redirects with no one-time banner', async () => {
    mockDecidable()
    const recordWorkItemDecision = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })
    const request = makeRequest({ decision: 'approved' })
    const h = makeToolkit()

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(request, h)

    expect(recordWorkItemDecision).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      outcome: 'approved',
      decisionNote: '',
      effectiveDate: null,
      user: { id: 'u-1', name: 'Alice' }
    })
    expect(request.yar.flash).not.toHaveBeenCalledWith(
      'flashBanner',
      expect.anything()
    )
    expect(h.redirect).toHaveBeenCalledWith(DETAIL_HREF)
  })

  // RA-527. Step 1 of a refusal: the persistent "Application refused" banner
  // on the detail page replaces the one-time success flash.
  test('records a Refused decision as the `rejected` wire value with no one-time banner', async () => {
    // The radio says "Refused"; the payload says `rejected` (the backend
    // contract).
    mockDecidable()
    const recordWorkItemDecision = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })
    const request = makeRequest({ decision: 'rejected' })

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(request, makeToolkit())

    expect(recordWorkItemDecision).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'rejected' })
    )
    expect(request.yar.flash).not.toHaveBeenCalledWith(
      'flashBanner',
      expect.anything()
    )
  })

  // RA-203. The note is the determination's rationale, recorded in the
  // application history.
  test('forwards a decision note to the service', async () => {
    mockDecidable()
    const recordWorkItemDecision = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(
      makeRequest({ decision: 'rejected', decisionNote: 'Capacity unproven' }),
      makeToolkit()
    )

    expect(recordWorkItemDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decisionNote: 'Capacity unproven' })
    )
  })

  test('echoes the typed note back when the radio was missed', async () => {
    // The note is the user's own prose — making them retype it because they
    // missed a radio would be gratuitous. The decision itself is still not
    // echoed (see the forged-value test above).
    mockDecidable()
    const h = makeToolkit()

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision: vi.fn() }
    }).handler(makeRequest({ decisionNote: 'Half-written rationale' }), h)

    expect(h.view).toHaveBeenCalledWith(
      'standard-lifecycle/decision/index',
      expect.objectContaining({
        values: {
          decision: null,
          decisionNote: 'Half-written rationale',
          effectiveDate: { day: '', month: '', year: '' }
        }
      })
    )
  })

  // RA-203. The counter is progressive enhancement; with no browser JS the
  // textarea submits happily, so the server has to catch this — and catch it
  // as a FORM error. Letting it fall through to the service would bounce the
  // user to the detail page with a generic banner and discard the rationale
  // they had just written.
  test('renders an over-long note in place, keeping the text, without calling the service', async () => {
    mockDecidable()
    const recordWorkItemDecision = vi.fn()
    const longNote = 'x'.repeat(2001)
    const h = makeToolkit()

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(makeRequest({ decision: 'approved', decisionNote: longNote }), h)

    expect(recordWorkItemDecision).not.toHaveBeenCalled()
    expect(h.redirect).not.toHaveBeenCalled()
    expect(h.view).toHaveBeenCalledWith(
      'standard-lifecycle/decision/index',
      expect.objectContaining({
        // The note must come back — it is the thing they need to shorten.
        values: {
          decision: 'approved',
          decisionNote: longNote,
          effectiveDate: { day: '', month: '', year: '' }
        },
        // RA-505: the re-render is still the same page, so it keeps the same
        // trail — this is the path a regression is most likely to miss.
        breadcrumbs: EXPECTED_BREADCRUMBS,
        errorSummary: {
          titleText: 'There is a problem',
          items: [
            {
              text: 'Decision note must be 2000 characters or fewer',
              href: '#field-decisionNote'
            }
          ]
        },
        fieldErrors: {
          decisionNote: 'Decision note must be 2000 characters or fewer'
        }
      })
    )
  })

  test('reports BOTH a missing radio and an over-long note, in field order', async () => {
    // Reporting only the first would make the user fix one, resubmit, and be
    // told about the other.
    mockDecidable()
    const h = makeToolkit()

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision: vi.fn() }
    }).handler(makeRequest({ decisionNote: 'x'.repeat(2001) }), h)

    const view = h.view.mock.calls.at(-1)[1]
    expect(view.errorSummary.items.map((i) => i.href)).toEqual([
      '#decision-approved',
      '#field-decisionNote'
    ])
    expect(Object.keys(view.fieldErrors).sort()).toEqual([
      'decision',
      'decisionNote'
    ])
  })

  test('accepts a note exactly at the limit', async () => {
    mockDecidable()
    const recordWorkItemDecision = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(
      makeRequest({ decision: 'approved', decisionNote: 'x'.repeat(2000) }),
      makeToolkit()
    )

    expect(recordWorkItemDecision).toHaveBeenCalled()
  })

  test('surfaces a failed note with copy saying the decision was NOT recorded', async () => {
    mockDecidable()
    const recordWorkItemDecision = vi.fn().mockResolvedValue({
      ok: false,
      outcome: 'note-failed',
      status: 502,
      message:
        'Could not save the decision note. The decision was not recorded.'
    })
    const request = makeRequest({
      decision: 'approved',
      decisionNote: 'Rationale'
    })

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(request, makeToolkit())

    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        type: 'error',
        title: 'Could not save the decision note'
      })
    )
  })

  test('decides from awaiting-decision too (the rescue path)', async () => {
    mockDecidable({ stateId: 'awaiting-decision' })
    const recordWorkItemDecision = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(makeRequest({ decision: 'approved' }), makeToolkit())

    expect(recordWorkItemDecision).toHaveBeenCalled()
  })

  test.each([[undefined], [''], ['refused'], ['approve'], [['approved']]])(
    're-renders the page with an error summary when the choice is %s',
    async (decision) => {
      mockDecidable()
      const recordWorkItemDecision = vi.fn()
      const h = makeToolkit()

      await makeSubmitDecisionController({
        service: { recordWorkItemDecision }
      }).handler(makeRequest({ decision }), h)

      expect(recordWorkItemDecision).not.toHaveBeenCalled()
      expect(h.redirect).not.toHaveBeenCalled()
      expect(h.view).toHaveBeenCalledWith(
        'standard-lifecycle/decision/index',
        expect.objectContaining({
          errorSummary: {
            titleText: 'There is a problem',
            items: [
              {
                text: 'Select the decision for this application',
                href: '#decision-approved'
              }
            ]
          },
          fieldErrors: {
            decision: 'Select the decision for this application'
          }
        })
      )
    }
  )

  test('never echoes a forged decision value back into the page', async () => {
    mockDecidable()
    const h = makeToolkit()

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision: vi.fn() }
    }).handler(makeRequest({ decision: '"><script>' }), h)

    expect(h.view).toHaveBeenCalledWith(
      'standard-lifecycle/decision/index',
      expect.objectContaining({
        values: {
          decision: null,
          decisionNote: '',
          effectiveDate: { day: '', month: '', year: '' }
        }
      })
    )
  })

  test('re-checks eligibility against freshly-read state, so a replayed form cannot decide twice', async () => {
    mockDecidable({ stateId: 'approved' })
    const recordWorkItemDecision = vi.fn()
    const request = makeRequest({ decision: 'approved' })
    const h = makeToolkit()

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(request, h)

    expect(recordWorkItemDecision).not.toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledWith(DETAIL_HREF)
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ type: 'error' })
    )
  })

  test('fails CLOSED when the work item cannot be re-read', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 502 })
    const recordWorkItemDecision = vi.fn()
    const request = makeRequest({ decision: 'approved' })

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(request, makeToolkit())

    expect(recordWorkItemDecision).not.toHaveBeenCalled()
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ type: 'error' })
    )
  })

  test('surfaces a conflict with reload-and-retry copy', async () => {
    mockDecidable()
    const recordWorkItemDecision = vi
      .fn()
      .mockResolvedValue({ ok: false, outcome: 'conflict', status: 409 })
    const request = makeRequest({ decision: 'approved' })

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(request, makeToolkit())

    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        text: 'This application has changed since you opened it. Refresh and try again.'
      })
    )
  })

  test('surfaces any other failure with generic copy and redirects', async () => {
    mockDecidable()
    const recordWorkItemDecision = vi
      .fn()
      .mockResolvedValue({ ok: false, outcome: 'server', status: 500 })
    const request = makeRequest({ decision: 'approved' })
    const h = makeToolkit()

    await makeSubmitDecisionController({
      service: { recordWorkItemDecision }
    }).handler(request, h)

    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        type: 'error',
        text: 'There was a problem recording this decision. Try again.'
      })
    )
    expect(h.redirect).toHaveBeenCalledWith(DETAIL_HREF)
  })
})

// RA-495 AC6. Add-ORS takes an effective date: required on Approved, not
// sent on Refused (the field is hidden then), and never before the date the
// request was submitted.
describe('the effective date on add-ORS', () => {
  const ADD_ORS_DECISION_HREF = '/work-items/add-overseas-site/wi-1/decision'

  function mockAddOrs() {
    mockDecidable({
      typeId: 'add-overseas-site',
      submittedAt: '2027-02-12T10:00:00Z'
    })
  }

  const showFor = () =>
    makeShowStandardDecisionController({ typeId: 'add-overseas-site' })
  const submitFor = (options) =>
    makeSubmitStandardDecisionController({
      typeId: 'add-overseas-site',
      ...options
    })

  const dated = (fields, day, month, year) => ({
    ...fields,
    'effective-date-day': day,
    'effective-date-month': month,
    'effective-date-year': year
  })

  test('the page asks for it', async () => {
    mockAddOrs()
    const h = makeToolkit()

    await showFor().handler(makeRequest(), h)

    expect(h.view).toHaveBeenCalledWith(
      'standard-lifecycle/decision/index',
      expect.objectContaining({
        formAction: ADD_ORS_DECISION_HREF,
        showEffectiveDate: true,
        effectiveDateId: 'effective-date'
      })
    )
  })

  test('an approval sends it', async () => {
    mockAddOrs()
    const recordWorkItemDecision = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })

    await submitFor({ service: { recordWorkItemDecision } }).handler(
      makeRequest(dated({ decision: 'approved' }, '1', '3', '2027')),
      makeToolkit()
    )

    expect(recordWorkItemDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'approved',
        effectiveDate: '2027-03-01'
      })
    )
  })

  test.each([
    ['missing', ['', '', ''], 'Enter the effective date'],
    ['unreal', ['30', '2', '2027'], 'Effective date must be a real date'],
    [
      'before the submission date',
      ['11', '2', '2027'],
      'Effective date must be on or after the date the request was submitted'
    ]
  ])(
    'an approval with a %s date is shown again with the error, keeping what was typed',
    async (_, [day, month, year], message) => {
      mockAddOrs()
      const recordWorkItemDecision = vi.fn()
      const h = makeToolkit()

      await submitFor({ service: { recordWorkItemDecision } }).handler(
        makeRequest(
          dated(
            { decision: 'approved', decisionNote: 'Fine' },
            day,
            month,
            year
          )
        ),
        h
      )

      expect(recordWorkItemDecision).not.toHaveBeenCalled()
      expect(h.view).toHaveBeenCalledWith(
        'standard-lifecycle/decision/index',
        expect.objectContaining({
          showEffectiveDate: true,
          values: {
            decision: 'approved',
            decisionNote: 'Fine',
            effectiveDate: { day, month, year }
          },
          errorSummary: {
            titleText: 'There is a problem',
            items: [{ text: message, href: '#effective-date-day' }]
          },
          fieldErrors: { effectiveDate: message }
        })
      )
    }
  )

  test('a refusal neither checks nor sends it', async () => {
    mockAddOrs()
    const recordWorkItemDecision = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })

    await submitFor({ service: { recordWorkItemDecision } }).handler(
      makeRequest(dated({ decision: 'rejected' }, 'x', '', '')),
      makeToolkit()
    )

    expect(recordWorkItemDecision).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'rejected', effectiveDate: null })
    )
  })

  test('a backend rejection of the date is bound to the field, not a banner', async () => {
    mockAddOrs()
    const recordWorkItemDecision = vi.fn().mockResolvedValue({
      ok: false,
      outcome: 'invalid',
      status: 400,
      errorCode: 'effective-date-before-submission',
      message: 'before submission'
    })
    const request = makeRequest(
      dated({ decision: 'approved' }, '1', '3', '2027')
    )
    const h = makeToolkit()

    await submitFor({ service: { recordWorkItemDecision } }).handler(request, h)

    expect(h.redirect).not.toHaveBeenCalled()
    expect(request.yar.flash).not.toHaveBeenCalled()
    expect(h.view).toHaveBeenCalledWith(
      'standard-lifecycle/decision/index',
      expect.objectContaining({
        fieldErrors: {
          effectiveDate:
            'Effective date must be on or after the date the request was submitted'
        }
      })
    )
  })
})
