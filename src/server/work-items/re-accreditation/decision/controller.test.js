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
import { reAccreditationType } from '../module.js'

import {
  makeShowDecisionController,
  makeSubmitDecisionController
} from './controller.js'

// Both handlers gate on the module's DECLARED decision transitions, resolved
// through the type registry — so these unit tests register the real type,
// exactly as the plugin does at boot. Registering the REAL declaration (not a
// stub) means a regression in `module.js` fails here too.
beforeEach(() => {
  clearWorkItemRegistry()
  registerWorkItemType(reAccreditationType)
})

const DETAIL_HREF = '/work-items/wi-1'
const DECISION_HREF = '/work-items/re-accreditation/wi-1/decision'

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
      're-accreditation/decision/index',
      expect.objectContaining({
        formAction: DECISION_HREF,
        cancelHref: DETAIL_HREF,
        values: { decision: null },
        errorSummary: null
      })
    )
  })

  test('redirects with a banner when the item is not decidable', async () => {
    // Guards the ROUTE, not just the CTA: the URL is guessable and
    // bookmarkable, and the state may have moved on since the detail page
    // was rendered.
    mockDecidable({ stateId: 'duly-made' })
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
  test('records an Approved decision and redirects with a success banner', async () => {
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
      user: { id: 'u-1', name: 'Alice' }
    })
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        type: 'success',
        title: 'Decision logged: Approved'
      })
    )
    expect(h.redirect).toHaveBeenCalledWith(DETAIL_HREF)
  })

  test('records a Refused decision as the `rejected` wire value', async () => {
    // The banner says "Refused"; the payload says `rejected`. Both matter:
    // the label is the story's AC, the wire value is the backend contract.
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
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ title: 'Decision logged: Refused' })
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
        're-accreditation/decision/index',
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
      're-accreditation/decision/index',
      expect.objectContaining({ values: { decision: null } })
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
