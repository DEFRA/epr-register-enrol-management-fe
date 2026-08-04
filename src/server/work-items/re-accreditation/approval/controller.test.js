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
  makeShowApprovalController,
  makeSubmitApprovalController
} from './controller.js'

// RA-346. Both handlers now gate on the module's DECLARED `approve`
// transition (`requiresAllTasksComplete: true`), resolved through the type
// registry — so these unit tests must register the real type, exactly as the
// plugin does at boot. Registering the REAL declaration (not a stub) means a
// regression in `module.js` fails here too.
beforeEach(() => {
  clearWorkItemRegistry()
  registerWorkItemType(reAccreditationType)
})

const COMPLETED_DECISION_TASK = {
  taskId: 'record-decision-rationale',
  displayName: 'Record decision rationale',
  status: 'Completed'
}

const PENDING_DECISION_TASK = {
  taskId: 'record-decision-rationale',
  displayName: 'Record decision rationale',
  status: 'InProgress'
}

/** A work item that is genuinely approvable: right state, tasks all done. */
function anEligibleWorkItem(overrides = {}) {
  return {
    id: 'wi-1',
    typeId: 're-accreditation',
    stateId: 'awaiting-decision',
    tasks: [COMPLETED_DECISION_TASK],
    payload: { applicationReference: 'RA-REF-001' },
    ...overrides
  }
}

function mockEligible(overrides = {}) {
  getWorkItem.mockResolvedValue({
    ok: true,
    workItem: anEligibleWorkItem(overrides)
  })
}

function buildHapi(overrides = {}) {
  const captured = {}
  const h = {
    view: vi.fn((path, ctx) => {
      captured.viewPath = path
      captured.viewCtx = ctx
      const sealed = { path, ctx, statusCode: undefined }
      sealed.code = (status) => {
        sealed.statusCode = status
        captured.statusCode = status
        return sealed
      }
      captured.lastView = sealed
      return sealed
    }),
    redirect: vi.fn((to) => {
      captured.redirectTo = to
      return { redirect: to }
    }),
    authenticated: vi.fn()
  }
  const request = {
    params: { id: 'wi-1' },
    payload: {},
    yar: { flash: vi.fn() },
    auth: { credentials: { scope: ['standard'] } },
    ...overrides
  }
  return { request, h, captured }
}

describe('makeShowApprovalController', () => {
  beforeEach(() => {
    getWorkItem.mockReset()
  })

  test('renders the interstitial for an eligible work item', async () => {
    mockEligible()
    const { request, h, captured } = buildHapi()
    await makeShowApprovalController().handler(request, h)

    expect(captured.viewPath).toBe('re-accreditation/approval/index')
    expect(captured.viewCtx.formAction).toBe(
      '/work-items/re-accreditation/wi-1/approve'
    )
    expect(captured.viewCtx.cancelHref).toBe('/work-items/wi-1')
    expect(captured.viewCtx.decisionNoteMaxLength).toBeGreaterThan(0)
  })

  test('redirects to the detail page with an error flash when the state is no longer eligible', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-1',
        stateId: 'approved',
        payload: { applicationReference: 'RA-REF-001' }
      }
    })
    const { request, h, captured } = buildHapi()
    await makeShowApprovalController().handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ type: 'error' })
    )
  })

  // RA-323: every caseworker has the same permissions, so the interstitial
  // renders for any authenticated caller once the item is eligible — there
  // is no assignee-or-decision-maker gate any more.
  test('renders the interstitial for a caller who is neither the assignee nor holds any special scope', async () => {
    mockEligible({ assignedToId: 'someone-else' })
    const { request, h, captured } = buildHapi({
      auth: { credentials: { scope: [] } }
    })
    await makeShowApprovalController().handler(request, h)

    expect(captured.viewPath).toBe('re-accreditation/approval/index')
  })

  // ------------------------------------------------------------------
  // RA-346 AC2. Guarding the ROUTE, not just the CTA. Hiding the button is
  // a UX affordance; this URL is guessable and bookmarkable, so a direct GET
  // while `record-decision-rationale` is pending must not reach the form.
  // ------------------------------------------------------------------
  test('RA-346: redirects with a tasks-incomplete banner on a direct GET while a decision task is pending', async () => {
    mockEligible({ tasks: [PENDING_DECISION_TASK] })
    const { request, h, captured } = buildHapi()
    await makeShowApprovalController().handler(request, h)

    expect(captured.viewPath).toBeUndefined()
    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        type: 'error',
        title: 'Could not approve this determination',
        text: 'Complete every task for this application before approving the determination.'
      })
    )
  })

  test('RA-346: the tasks-incomplete banner is distinct from the wrong-state banner', async () => {
    mockEligible({ stateId: 'approved', tasks: [COMPLETED_DECISION_TASK] })
    const { request, h } = buildHapi()
    await makeShowApprovalController().handler(request, h)

    const [, banner] = request.yar.flash.mock.calls[0]
    expect(banner.text).toBe(
      'This work item can no longer be approved from its current state.'
    )
  })

  test('renders the not-found view with HTTP 404 when the backend returns 404', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })
    const { request, h, captured } = buildHapi()
    await makeShowApprovalController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/not-found')
    expect(captured.statusCode).toBe(404)
  })

  test('renders the unavailable view with HTTP 502 on any other backend failure', async () => {
    getWorkItem.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'oops'
    })
    const { request, h, captured } = buildHapi()
    await makeShowApprovalController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/detail-error')
    expect(captured.statusCode).toBe(502)
    expect(captured.viewCtx.error).toBe('oops')
  })

  test('falls back to a generic error message when the backend failure has no error field', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 502 })
    const { request, h, captured } = buildHapi()
    await makeShowApprovalController().handler(request, h)

    expect(captured.viewCtx.error).toBe('Backend returned 502')
  })
})

describe('makeSubmitApprovalController', () => {
  // RA-346. The POST re-reads the work item and re-checks eligibility before
  // calling the service, so every test needs an approvable item by default.
  beforeEach(() => {
    getWorkItem.mockReset()
    mockEligible()
  })

  test('redirects with a success banner when the approval succeeds', async () => {
    const service = {
      approveWorkItem: vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'wi-1' }
      })
    }
    const { request, h, captured } = buildHapi({
      payload: { decisionNote: 'looks good' }
    })
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(service.approveWorkItem).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      decisionNote: 'looks good',
      user: { id: 'u-1', name: 'Alice' }
    })
    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ type: 'success' })
    )
  })

  test('renders the interstitial with HTTP 400 when the decision note exceeds the max length', async () => {
    const service = { approveWorkItem: vi.fn() }
    const longNote = 'x'.repeat(2001)
    const { request, h, captured } = buildHapi({
      payload: { decisionNote: longNote }
    })
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(service.approveWorkItem).not.toHaveBeenCalled()
    expect(captured.viewPath).toBe('re-accreditation/approval/index')
    expect(captured.statusCode).toBe(400)
    expect(captured.viewCtx.errorSummary.items[0].text).toMatch(/2000/)
    expect(captured.viewCtx.fieldErrors.decisionNote).toMatch(/2000/)
  })

  test('redirects with a conflict banner when the service returns outcome=conflict', async () => {
    const service = {
      approveWorkItem: vi.fn().mockResolvedValue({
        ok: false,
        outcome: 'conflict',
        status: 409,
        message: 'race'
      })
    }
    const { request, h, captured } = buildHapi()
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        type: 'error',
        text: expect.stringMatching(/Refresh and try again/)
      })
    )
  })

  test('redirects with a note-failed banner including the message from the service', async () => {
    const service = {
      approveWorkItem: vi.fn().mockResolvedValue({
        ok: false,
        outcome: 'note-failed',
        message: 'Note text is required.'
      })
    }
    const { request, h, captured } = buildHapi()
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ text: 'Note text is required.' })
    )
  })

  test('uses a default message when the note-failed result has none', async () => {
    const service = {
      approveWorkItem: vi.fn().mockResolvedValue({
        ok: false,
        outcome: 'note-failed'
      })
    }
    const { request, h } = buildHapi()
    await makeSubmitApprovalController({ service }).handler(request, h)

    const [, banner] = request.yar.flash.mock.calls[0]
    expect(banner.text).toMatch(/could not be saved/i)
  })

  test('redirects with a generic error banner for any other failure', async () => {
    const service = {
      approveWorkItem: vi.fn().mockResolvedValue({
        ok: false,
        outcome: 'server',
        status: 500
      })
    }
    const { request, h, captured } = buildHapi()
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        text: expect.stringMatching(/problem approving/i)
      })
    )
  })

  test('coerces a missing or non-string decisionNote payload to empty', async () => {
    const service = {
      approveWorkItem: vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'wi-1' }
      })
    }
    const { request, h } = buildHapi({ payload: { decisionNote: 42 } })
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(service.approveWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ decisionNote: '' })
    )
  })

  test('tolerates an undefined payload (handler must not throw)', async () => {
    const service = {
      approveWorkItem: vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'wi-1' }
      })
    }
    const { request, h } = buildHapi()
    request.payload = undefined
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(service.approveWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ decisionNote: '' })
    )
  })

  // ------------------------------------------------------------------
  // RA-346 AC2. The route guard. A hidden button is not a control — a
  // replayed form post or a hand-rolled POST must be refused here, BEFORE
  // the service (and therefore the backend) is called at all.
  // ------------------------------------------------------------------
  test('RA-346: refuses a direct POST while a decision task is pending and never calls the service', async () => {
    mockEligible({ tasks: [PENDING_DECISION_TASK] })
    const service = { approveWorkItem: vi.fn() }
    const { request, h, captured } = buildHapi()
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(service.approveWorkItem).not.toHaveBeenCalled()
    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        type: 'error',
        text: 'Complete every task for this application before approving the determination.'
      })
    )
  })

  test('RA-346: refuses a POST when the work item has left awaiting-decision', async () => {
    mockEligible({ stateId: 'approved' })
    const service = { approveWorkItem: vi.fn() }
    const { request, h } = buildHapi()
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(service.approveWorkItem).not.toHaveBeenCalled()
    const [, banner] = request.yar.flash.mock.calls[0]
    expect(banner.text).toBe(
      'This work item can no longer be approved from its current state.'
    )
  })

  // Fail CLOSED: if we cannot re-read the work item we cannot prove the
  // approval is permitted, so we must not attempt it.
  test('RA-346: does not approve when the eligibility re-read fails', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 503, error: 'down' })
    const service = { approveWorkItem: vi.fn() }
    const { request, h, captured } = buildHapi()
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(service.approveWorkItem).not.toHaveBeenCalled()
    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        type: 'error',
        text: expect.stringMatching(/problem approving/i)
      })
    )
  })

  // The over-length note is rejected before the eligibility re-read, so the
  // user gets the inline field error rather than a redirect.
  test('RA-346: the note-length guard still short-circuits ahead of the eligibility check', async () => {
    mockEligible({ tasks: [PENDING_DECISION_TASK] })
    const service = { approveWorkItem: vi.fn() }
    const { request, h, captured } = buildHapi({
      payload: { decisionNote: 'x'.repeat(2001) }
    })
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(captured.statusCode).toBe(400)
    expect(service.approveWorkItem).not.toHaveBeenCalled()
  })

  // ------------------------------------------------------------------
  // RA-346. Backend rejection. `ra346-be` adds a server-side gate on the
  // approve endpoint; if the tasks are completed between our re-read and
  // the backend's own check (or the FE gate is somehow bypassed), the
  // backend's refusal must surface as the SAME actionable message the FE
  // guard uses — not a generic "there was a problem".
  // ------------------------------------------------------------------
  test('RA-346: maps a backend tasks-incomplete rejection to the actionable banner', async () => {
    const service = {
      approveWorkItem: vi.fn().mockResolvedValue({
        ok: false,
        outcome: 'tasks-incomplete',
        status: 409,
        message: 'All tasks must be complete before approving.'
      })
    }
    const { request, h, captured } = buildHapi()
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        type: 'error',
        title: 'Could not approve this determination',
        text: 'Complete every task for this application before approving the determination.'
      })
    )
  })

  test('tolerates a missing yar (no flash call)', async () => {
    const service = {
      approveWorkItem: vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'wi-1' }
      })
    }
    const { request, h, captured } = buildHapi()
    delete request.yar
    await makeSubmitApprovalController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
  })

  test('makeSubmitApprovalController() uses the default service when none is injected', () => {
    const handler = makeSubmitApprovalController()
    expect(typeof handler.handler).toBe('function')
  })
})
