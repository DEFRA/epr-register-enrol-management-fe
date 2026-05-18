import { describe, expect, test, vi, beforeEach } from 'vitest'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
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
  makeShowApprovalController,
  makeSubmitApprovalController
} from './controller.js'

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
    auth: { credentials: { scope: ['reaccreditation-decision-maker'] } },
    ...overrides
  }
  return { request, h, captured }
}

describe('makeShowApprovalController', () => {
  beforeEach(() => {
    getWorkItem.mockReset()
  })

  test('renders the interstitial for an eligible work item', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-1', stateId: 'assessment-in-progress' }
    })
    const { request, h, captured } = buildHapi()
    await makeShowApprovalController().handler(request, h)

    expect(captured.viewPath).toBe('re-accreditation/approval/index')
    expect(captured.viewCtx.formAction).toBe('/work-items/wi-1/approve')
    expect(captured.viewCtx.cancelHref).toBe('/work-items/wi-1')
    expect(captured.viewCtx.decisionNoteMaxLength).toBeGreaterThan(0)
  })

  test('redirects to the detail page with an error flash when the state is no longer eligible', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-1', stateId: 'approved' }
    })
    const { request, h, captured } = buildHapi()
    await makeShowApprovalController().handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ type: 'error' })
    )
  })

  test('redirects with an error flash when the caller is neither assignee nor decision-maker', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-1',
        stateId: 'assessment-in-progress',
        assignedToId: 'someone-else'
      }
    })
    const { request, h, captured } = buildHapi({
      auth: { credentials: { scope: [] } }
    })
    await makeShowApprovalController().handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({
        type: 'error',
        text: expect.stringMatching(/permission/i)
      })
    )
  })

  test('renders the interstitial when the caller is the assignee even without the decision-maker role', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-1',
        stateId: 'assessment-in-progress',
        assignedToId: 'u-1'
      }
    })
    const { request, h, captured } = buildHapi({
      auth: { credentials: { scope: [] } }
    })
    await makeShowApprovalController().handler(request, h)

    expect(captured.viewPath).toBe('re-accreditation/approval/index')
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
