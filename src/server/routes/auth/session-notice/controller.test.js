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
    const request = {
      headers: {},
      info: {
        referrer: 'https://service.test/work-items/1',
        host: 'service.test'
      }
    }
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

  test('redirects back to the same-host referrer path for a no-JS form post', async () => {
    const h = makeH()
    await dismissSessionNoticeController(
      {
        headers: {},
        info: {
          referrer: 'https://service.test/work-items/1',
          host: 'service.test'
        }
      },
      h
    )
    expect(h.redirect).toHaveBeenCalledWith('/work-items/1')
  })

  test('ignores a cross-host referrer (no open redirect)', async () => {
    const h = makeH()
    await dismissSessionNoticeController(
      {
        headers: {},
        info: { referrer: 'https://evil.example/phish', host: 'service.test' }
      },
      h
    )
    expect(h.redirect).toHaveBeenCalledWith('/work-items')
  })

  test('redirects to /work-items when there is no referrer', async () => {
    const h = makeH()
    await dismissSessionNoticeController(
      { headers: {}, info: { host: 'service.test' } },
      h
    )
    expect(h.redirect).toHaveBeenCalledWith('/work-items')
  })
})
