import Boom from '@hapi/boom'
import { redirectToLogin, popPostLoginRedirect } from './auth-redirect.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

function fakeYar() {
  const store = new Map()
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    clear: (key) => store.delete(key)
  }
}

describe('redirectToLogin', () => {
  const h = {
    continue: Symbol('continue'),
    redirect: (url) => ({ redirected: url })
  }

  test('passes through when response is not a Boom error', () => {
    const request = { response: { isBoom: false } }
    expect(redirectToLogin(request, h)).toBe(h.continue)
  })

  test('passes through for non-401 Boom errors', () => {
    const request = {
      response: { isBoom: true, output: { statusCode: 403 } }
    }
    expect(redirectToLogin(request, h)).toBe(h.continue)
  })

  test('redirects to /auth/regulator/login on 401', () => {
    const request = {
      response: { isBoom: true, output: { statusCode: 401 } }
    }
    expect(redirectToLogin(request, h)).toEqual({
      redirected: '/auth/regulator/login'
    })
  })

  describe('post-login redirect stashing', () => {
    test('stashes the originally requested GET URL, including query string', () => {
      const yar = fakeYar()
      const request = {
        response: { isBoom: true, output: { statusCode: 401 } },
        method: 'get',
        path: '/work-items/123',
        url: { search: '?foo=bar' },
        yar
      }
      redirectToLogin(request, h)
      expect(yar.get('postLoginRedirect')).toBe('/work-items/123?foo=bar')
    })

    test('does not stash a non-GET request', () => {
      const yar = fakeYar()
      const request = {
        response: { isBoom: true, output: { statusCode: 401 } },
        method: 'post',
        path: '/work-items/123',
        url: { search: '' },
        yar
      }
      redirectToLogin(request, h)
      expect(yar.get('postLoginRedirect')).toBeUndefined()
    })

    test('does not stash a request for an /auth/* path', () => {
      const yar = fakeYar()
      const request = {
        response: { isBoom: true, output: { statusCode: 401 } },
        method: 'get',
        path: '/auth/regulator/login',
        url: { search: '' },
        yar
      }
      redirectToLogin(request, h)
      expect(yar.get('postLoginRedirect')).toBeUndefined()
    })
  })
})

// --- Integration test: the full 401 -> login -> redirect-back round trip
// through the real running server (real yar session, real cookies). This
// is the case a mocked-yar unit test can't catch: the stash only survives
// if redirectToLogin's onPreResponse handler runs, and commits, *before*
// yar's own onPreResponse commit handler — an ordering determined by
// plugin registration order in server.js, not by anything in this file.
describe('post-login redirect (end-to-end)', () => {
  let server

  beforeAll(async () => {
    server = await createServer()

    server.route({
      method: 'GET',
      path: '/test-requires-login',
      options: { auth: false },
      handler: () => {
        throw Boom.unauthorized(null, 'session')
      }
    })

    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  function extractCookies(headers) {
    const cookies = {}
    for (const header of headers['set-cookie'] ?? []) {
      const [pair] = header.split(';')
      const [key, value] = pair.split('=')
      cookies[key] = value
    }
    return cookies
  }

  function cookieHeader(cookies) {
    return Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
  }

  test('sends the user back to the originally requested URL after stub login', async () => {
    const loginRedirect = await server.inject({
      method: 'GET',
      url: '/test-requires-login?foo=bar'
    })
    expect(loginRedirect.statusCode).toBe(statusCodes.redirect)
    expect(loginRedirect.headers.location).toBe('/auth/regulator/login')

    let cookies = extractCookies(loginRedirect.headers)
    expect(cookies.session).toBeTruthy()

    // Fetch a crumb token bound to the *same* session established above —
    // hitting '/' with a fresh request/cookie jar (the injectWithCrumb test
    // helper's default behaviour) would mint a new session and lose the
    // stashed redirect target.
    const loginPage = await server.inject({
      method: 'GET',
      url: '/auth/stub/login',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = { ...cookies, ...extractCookies(loginPage.headers) }
    const crumb = loginPage.result.match(/name="crumb" value="([^"]+)"/)[1]

    const stubLogin = await server.inject({
      method: 'POST',
      url: '/auth/stub/login',
      headers: { cookie: cookieHeader(cookies) },
      payload: { nation: '', crumb }
    })

    expect(stubLogin.statusCode).toBe(statusCodes.redirect)
    expect(stubLogin.headers.location).toBe('/test-requires-login?foo=bar')
  })

  test('falls back to "/work-items" when the user navigates to login directly', async () => {
    const loginPage = await server.inject({
      method: 'GET',
      url: '/auth/stub/login'
    })
    const cookies = extractCookies(loginPage.headers)
    const crumb = loginPage.result.match(/name="crumb" value="([^"]+)"/)[1]

    const stubLogin = await server.inject({
      method: 'POST',
      url: '/auth/stub/login',
      headers: { cookie: cookieHeader(cookies) },
      payload: { nation: '', crumb }
    })

    expect(stubLogin.statusCode).toBe(statusCodes.redirect)
    expect(stubLogin.headers.location).toBe('/work-items')
  })
})

describe('#popPostLoginRedirect', () => {
  test('returns and clears the stashed target', () => {
    const yar = fakeYar()
    yar.set('postLoginRedirect', '/work-items/123')
    const request = { yar }
    expect(popPostLoginRedirect(request, '/work-items')).toBe('/work-items/123')
    expect(yar.get('postLoginRedirect')).toBeUndefined()
  })

  test('returns the fallback when nothing was stashed', () => {
    const request = { yar: fakeYar() }
    expect(popPostLoginRedirect(request, '/work-items')).toBe('/work-items')
  })

  test('returns the fallback for a protocol-relative stashed value (open-redirect guard)', () => {
    const yar = fakeYar()
    yar.set('postLoginRedirect', '//evil.example')
    const request = { yar }
    expect(popPostLoginRedirect(request, '/work-items')).toBe('/work-items')
  })
})
