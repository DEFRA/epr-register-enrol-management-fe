import { vi } from 'vitest'
import hapi from '@hapi/hapi'
import Yar from '@hapi/yar'

import {
  consentConfirmationFor,
  popConsentConfirmation,
  setConsentConfirmation,
  takeConsentConfirmationForView
} from './confirmation.js'

function fakeYar(initial = {}) {
  const store = { ...initial }
  return {
    get: vi.fn((key) => store[key]),
    set: vi.fn((key, value) => {
      store[key] = value
    }),
    clear: vi.fn((key) => {
      delete store[key]
    })
  }
}

const h = { continue: Symbol('continue') }

describe('consent confirmation', () => {
  test('a stored choice is returned once, then cleared', () => {
    const request = { yar: fakeYar() }

    setConsentConfirmation(request, 'accepted')

    expect(popConsentConfirmation(request)).toBe('accepted')
    expect(popConsentConfirmation(request)).toBeNull()
  })

  test('leaves the session untouched when nothing is pending', () => {
    const request = { yar: fakeYar() }

    expect(popConsentConfirmation(request)).toBeNull()
    expect(request.yar.clear).not.toHaveBeenCalled()
    expect(request.yar.set).not.toHaveBeenCalled()
  })

  test('copes with a request that has no session', () => {
    expect(popConsentConfirmation(null)).toBeNull()
    expect(popConsentConfirmation({})).toBeNull()
    expect(() => setConsentConfirmation({}, 'rejected')).not.toThrow()
  })

  describe('takeConsentConfirmationForView', () => {
    test('a rendered page takes the pending confirmation', () => {
      const request = {
        app: {},
        response: { variety: 'view' },
        yar: fakeYar({ analyticsConsentConfirmation: 'rejected' })
      }

      expect(takeConsentConfirmationForView(request, h)).toBe(h.continue)
      expect(consentConfirmationFor(request)).toBe('rejected')
      expect(popConsentConfirmation(request)).toBeNull()
    })

    test.each([
      ['a redirect', { variety: 'plain', statusCode: 302 }],
      ['an error', { isBoom: true }],
      ['no response', undefined]
    ])('%s leaves it for the next page', (_label, response) => {
      const request = {
        app: {},
        response,
        yar: fakeYar({ analyticsConsentConfirmation: 'accepted' })
      }

      takeConsentConfirmationForView(request, h)

      expect(consentConfirmationFor(request)).toBeNull()
      expect(popConsentConfirmation(request)).toBe('accepted')
    })
  })

  test('consentConfirmationFor copes with no request', () => {
    expect(consentConfirmationFor(null)).toBeNull()
    expect(consentConfirmationFor({})).toBeNull()
  })

  // Uses real yar with its default cookie-stored session (as local
  // development does): a clear made after yar writes the cookie would be lost.
  test('the clear is saved with the session, so the message shows only once', async () => {
    const server = hapi.server()
    await server.register({
      plugin: Yar,
      options: { cookieOptions: { password: 'x'.repeat(32), isSecure: false } }
    })
    server.ext('onPreResponse', takeConsentConfirmationForView, {
      before: ['@hapi/yar']
    })
    server.route([
      {
        method: 'GET',
        path: '/answer',
        handler: (request) => {
          setConsentConfirmation(request, 'accepted')
          return 'ok'
        }
      },
      {
        method: 'GET',
        path: '/page',
        handler: (request, h) => {
          // Stands in for a view: what matters is the variety the
          // extension sees, and that the session is saved after it.
          const response = h.response('page')
          response.variety = 'view'
          return response
        }
      },
      {
        method: 'GET',
        path: '/peek',
        handler: (request) =>
          request.yar.get('analyticsConsentConfirmation') ?? 'none'
      }
    ])

    let cookie = ''
    const send = async (url) => {
      const res = await server.inject({ url, headers: { cookie } })
      const session = []
        .concat(res.headers['set-cookie'] ?? [])
        .find((c) => c.startsWith('session='))
      if (session) {
        cookie = session.split(';')[0]
      }
      return res
    }

    await send('/answer')
    expect((await send('/peek')).result).toBe('accepted')
    await send('/page')
    expect((await send('/peek')).result).toBe('none')
  })
})
