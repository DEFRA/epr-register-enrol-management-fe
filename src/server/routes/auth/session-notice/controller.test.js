import { describe, test, expect, vi, beforeEach } from 'vitest'

const dismissNotice = vi.fn()
vi.mock('#/server/common/helpers/auth/concurrent-login.js', () => ({
  dismissNotice: (...args) => dismissNotice(...args)
}))

const { dismissSessionNoticeController } = await import('./controller.js')

function makeH() {
  const response = { code: vi.fn().mockReturnThis() }
  return {
    response: vi.fn(() => response),
    redirect: vi.fn((to) => ({ redirectedTo: to })),
    _response: response
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dismissSessionNoticeController', () => {
  test('always records the dismissal', async () => {
    const request = { headers: {}, info: { referrer: '/work-items/1' } }
    await dismissSessionNoticeController(request, makeH())
    expect(dismissNotice).toHaveBeenCalledWith(request)
  })

  test('returns 204 for a fetch (Accept: application/json)', async () => {
    const h = makeH()
    await dismissSessionNoticeController(
      { headers: { accept: 'application/json' }, info: { referrer: '/x' } },
      h
    )
    expect(h._response.code).toHaveBeenCalledWith(204)
    expect(h.redirect).not.toHaveBeenCalled()
  })

  test('redirects back to the referrer for a no-JS form post', async () => {
    const h = makeH()
    await dismissSessionNoticeController(
      { headers: {}, info: { referrer: '/work-items/1' } },
      h
    )
    expect(h.redirect).toHaveBeenCalledWith('/work-items/1')
  })

  test('redirects to /work-items when there is no referrer', async () => {
    const h = makeH()
    await dismissSessionNoticeController({ headers: {}, info: {} }, h)
    expect(h.redirect).toHaveBeenCalledWith('/work-items')
  })
})
