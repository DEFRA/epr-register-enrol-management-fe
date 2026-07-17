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
  makeShowWithdrawController,
  makeSubmitWithdrawController
} from './withdraw.controller.js'
import { WITHDRAW_NOTE_MAX_LENGTH } from './withdraw.service.js'

function buildHapi({ params = {}, payload = {} } = {}) {
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
      return sealed
    }),
    redirect: vi.fn((to) => {
      captured.redirectTo = to
      return { redirect: to }
    })
  }
  const request = {
    params: { id: 'wi-1', actionId: 'withdraw', ...params },
    payload,
    yar: { flash: vi.fn() },
    auth: { credentials: { scope: [] } }
  }
  return { request, h, captured }
}

describe('makeShowWithdrawController', () => {
  beforeEach(() => {
    getWorkItem.mockReset()
  })

  test('redirects with a banner when actionId is not a withdraw variant', async () => {
    const { request, h, captured } = buildHapi({
      params: { actionId: 'approve' }
    })

    await makeShowWithdrawController().handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ type: 'error' })
    )
    expect(getWorkItem).not.toHaveBeenCalled()
  })

  test('renders 404 when the work item is missing', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })
    const { request, h, captured } = buildHapi()

    await makeShowWithdrawController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/not-found')
    expect(captured.statusCode).toBe(404)
  })

  test('renders 502 when the backend is unavailable', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 503, error: 'boom' })
    const { request, h, captured } = buildHapi()

    await makeShowWithdrawController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/detail-error')
    expect(captured.statusCode).toBe(502)
    expect(captured.viewCtx.error).toBe('boom')
  })

  test('falls back to a generic backend error message when none provided', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 500 })
    const { request, h, captured } = buildHapi()

    await makeShowWithdrawController().handler(request, h)

    expect(captured.viewCtx.error).toBe('Backend returned 500')
  })

  test('redirects with a banner when the withdraw action is no longer available', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-1',
        availableActions: [{ actionId: 'approve' }],
        payload: { applicationReference: 'RA-000000001' }
      }
    })
    const { request, h, captured } = buildHapi()

    await makeShowWithdrawController().handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ type: 'error' })
    )
  })

  test('handles a work item with no availableActions array', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-1',
        payload: { applicationReference: 'RA-000000001' }
      }
    })
    const { request, h, captured } = buildHapi()

    await makeShowWithdrawController().handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
  })

  test('renders the interstitial for an eligible withdraw action', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-1',
        availableActions: [
          { actionId: 'withdraw-during-assessment', displayName: 'Withdraw' }
        ],
        payload: { applicationReference: 'RA-000000001' }
      }
    })
    const { request, h, captured } = buildHapi({
      params: { actionId: 'withdraw-during-assessment' }
    })

    await makeShowWithdrawController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/withdraw')
    expect(captured.viewCtx.formAction).toBe(
      '/work-items/wi-1/actions/withdraw-during-assessment/confirm'
    )
    expect(captured.viewCtx.cancelHref).toBe('/work-items/wi-1')
    expect(captured.viewCtx.actionDisplayName).toBe('Withdraw')
    expect(captured.viewCtx.noteMaxLength).toBe(WITHDRAW_NOTE_MAX_LENGTH)
  })

  test('defaults the action display name when the projection omits one', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-1',
        availableActions: [{ actionId: 'withdraw' }],
        payload: { applicationReference: 'RA-000000001' }
      }
    })
    const { request, h, captured } = buildHapi()

    await makeShowWithdrawController().handler(request, h)

    expect(captured.viewCtx.actionDisplayName).toBe('Withdraw')
  })

  // RA-196: the breadcrumb text and the workItem passed to the template
  // show the application reference when present; the breadcrumb href and
  // form action keep the internal id.
  test('uses the application reference for the breadcrumb text, keeping the id in the href', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-1',
        availableActions: [{ actionId: 'withdraw', displayName: 'Withdraw' }],
        payload: { applicationReference: 'RA-111222333' }
      }
    })
    const { request, h, captured } = buildHapi()

    await makeShowWithdrawController().handler(request, h)

    expect(captured.viewCtx.breadcrumbs[1]).toEqual({
      text: 'RA-111222333',
      href: '/work-items/wi-1'
    })
    expect(captured.viewCtx.workItem.applicationRef).toBe('RA-111222333')
    expect(captured.viewCtx.formAction).toBe(
      '/work-items/wi-1/actions/withdraw/confirm'
    )
  })
})

describe('makeSubmitWithdrawController', () => {
  test('redirects when actionId is not a withdraw variant', async () => {
    const service = { withdrawWorkItem: vi.fn() }
    const { request, h, captured } = buildHapi({
      params: { actionId: 'approve' }
    })

    await makeSubmitWithdrawController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(service.withdrawWorkItem).not.toHaveBeenCalled()
  })

  test('renders an inline error when the note is too long', async () => {
    const service = { withdrawWorkItem: vi.fn() }
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-1',
        availableActions: [{ actionId: 'withdraw', displayName: 'Withdraw' }],
        payload: { applicationReference: 'RA-123456789' }
      }
    })
    const { request, h, captured } = buildHapi({
      payload: { note: 'x'.repeat(WITHDRAW_NOTE_MAX_LENGTH + 1) }
    })

    await makeSubmitWithdrawController({ service }).handler(request, h)

    expect(captured.viewPath).toBe('work-items/withdraw')
    expect(captured.statusCode).toBe(400)
    expect(captured.viewCtx.workItem.applicationRef).toBe('RA-123456789')
    expect(captured.viewCtx.errorSummary.items[0].href).toBe('#field-note')
    expect(captured.viewCtx.fieldErrors.note).toContain(
      String(WITHDRAW_NOTE_MAX_LENGTH)
    )
    expect(service.withdrawWorkItem).not.toHaveBeenCalled()
  })

  test('treats a non-string note as empty (length guard short-circuits)', async () => {
    const service = {
      withdrawWorkItem: vi.fn().mockResolvedValue({
        ok: true,
        workItem: {
          id: 'wi-1',
          payload: { applicationReference: 'RA-000000001' }
        }
      })
    }
    const { request, h, captured } = buildHapi({ payload: { note: 42 } })

    await makeSubmitWithdrawController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(service.withdrawWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ note: '' })
    )
  })

  test('flashes success and redirects on a successful withdrawal', async () => {
    const service = {
      withdrawWorkItem: vi.fn().mockResolvedValue({
        ok: true,
        workItem: {
          id: 'wi-1',
          payload: { applicationReference: 'RA-000000001' }
        }
      })
    }
    const { request, h, captured } = buildHapi({ payload: { note: 'why' } })

    await makeSubmitWithdrawController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith(
      'flashBanner',
      expect.objectContaining({ type: 'success' })
    )
  })

  test.each([
    ['conflict', 'state changed'],
    ['forbidden', 'permission'],
    ['note-failed', 'could not save the withdrawal note'],
    ['server', 'problem withdrawing']
  ])('flashes an error banner for outcome %p', async (outcome, expected) => {
    const service = {
      withdrawWorkItem: vi
        .fn()
        .mockResolvedValue({ ok: false, outcome, message: 'detail' })
    }
    const { request, h, captured } = buildHapi()

    await makeSubmitWithdrawController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    const banner = request.yar.flash.mock.calls[0][1]
    expect(banner.type).toBe('error')
    expect(JSON.stringify(banner).toLowerCase()).toContain(
      expected.toLowerCase()
    )
  })

  test('uses a default message when note-failed has no message', async () => {
    const service = {
      withdrawWorkItem: vi
        .fn()
        .mockResolvedValue({ ok: false, outcome: 'note-failed' })
    }
    const { request, h } = buildHapi()

    await makeSubmitWithdrawController({ service }).handler(request, h)

    const banner = request.yar.flash.mock.calls[0][1]
    expect(banner.text).toMatch(/could not be saved/i)
  })

  test('falls back to a generic empty payload', async () => {
    const service = {
      withdrawWorkItem: vi.fn().mockResolvedValue({
        ok: true,
        workItem: {
          id: 'wi-1',
          payload: { applicationReference: 'RA-000000001' }
        }
      })
    }
    const { request, h, captured } = buildHapi()
    request.payload = null

    await makeSubmitWithdrawController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(service.withdrawWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ note: '' })
    )
  })
})

describe('makeShowWithdrawController missing yar', () => {
  test('does not throw when yar.flash is missing', async () => {
    const { request, h, captured } = buildHapi({
      params: { actionId: 'approve' }
    })
    request.yar = undefined

    await makeShowWithdrawController().handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
  })
})
