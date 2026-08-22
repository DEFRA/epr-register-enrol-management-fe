import Boom from '@hapi/boom'
import { vi } from 'vitest'
import {
  redirectToLogin,
  confirmPostLoginRedirect,
  popPostLoginRedirect
} from './auth-redirect.js'
import {
  ROLE_STANDARD,
  ROLE_SUPPORT_READONLY
} from '#/server/common/helpers/auth/auth-scopes.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { config } from '#/config/config.js'

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
    test('stashes the originally requested GET URL, including query string, with a nonce', () => {
      const yar = fakeYar()
      const request = {
        response: { isBoom: true, output: { statusCode: 401 } },
        method: 'get',
        path: '/work-items/123',
        url: { search: '?foo=bar' },
        yar
      }
      redirectToLogin(request, h)
      const stashed = yar.get('postLoginRedirect')
      expect(stashed.target).toBe('/work-items/123?foo=bar')
      expect(typeof stashed.nonce).toBe('string')
      expect(stashed.nonce.length).toBeGreaterThan(0)
    })

    test('stashes no required role for a route with no scope requirement', () => {
      const yar = fakeYar()
      const request = {
        response: { isBoom: true, output: { statusCode: 401 } },
        method: 'get',
        path: '/work-items',
        url: { search: '' },
        route: { settings: { auth: { access: [] } } },
        yar
      }
      redirectToLogin(request, h)
      expect(yar.get('postLoginRedirect').role).toBeNull()
    })

    test('stashes the required role for a standard-scoped route', () => {
      const yar = fakeYar()
      const request = {
        response: { isBoom: true, output: { statusCode: 401 } },
        method: 'get',
        path: '/work-items/123/assign',
        url: { search: '' },
        route: {
          settings: {
            auth: { access: [{ scope: { selection: [ROLE_STANDARD] } }] }
          }
        },
        yar
      }
      redirectToLogin(request, h)
      expect(yar.get('postLoginRedirect').role).toBe(ROLE_STANDARD)
    })

    test('stashes the required role for a support-readonly-scoped route', () => {
      const yar = fakeYar()
      const request = {
        response: { isBoom: true, output: { statusCode: 401 } },
        method: 'get',
        path: '/backend-status',
        url: { search: '' },
        route: {
          settings: {
            auth: {
              access: [{ scope: { selection: [ROLE_SUPPORT_READONLY] } }]
            }
          }
        },
        yar
      }
      redirectToLogin(request, h)
      expect(yar.get('postLoginRedirect').role).toBe(ROLE_SUPPORT_READONLY)
    })

    test('carries the nonce in the login redirect query string', () => {
      const yar = fakeYar()
      const request = {
        response: { isBoom: true, output: { statusCode: 401 } },
        method: 'get',
        path: '/work-items/123',
        url: { search: '' },
        yar
      }
      const result = redirectToLogin(request, h)
      const stashed = yar.get('postLoginRedirect')
      expect(result).toEqual({
        redirected: `/auth/regulator/login?rt=${stashed.nonce}`
      })
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

describe('#confirmPostLoginRedirect', () => {
  test('keeps the stash when the request carries the matching nonce', () => {
    const yar = fakeYar()
    yar.set('postLoginRedirect', { target: '/work-items/123', nonce: 'n1' })
    const request = { yar, query: { rt: 'n1' } }
    confirmPostLoginRedirect(request)
    expect(yar.get('postLoginRedirect')).toBeDefined()
  })

  test('drops the stash when the nonce is missing (a direct, unrelated visit)', () => {
    const yar = fakeYar()
    yar.set('postLoginRedirect', { target: '/work-items/123', nonce: 'n1' })
    const request = { yar, query: {} }
    confirmPostLoginRedirect(request)
    expect(yar.get('postLoginRedirect')).toBeUndefined()
  })

  test('drops the stash when the nonce does not match', () => {
    const yar = fakeYar()
    yar.set('postLoginRedirect', { target: '/work-items/123', nonce: 'n1' })
    const request = { yar, query: { rt: 'wrong' } }
    confirmPostLoginRedirect(request)
    expect(yar.get('postLoginRedirect')).toBeUndefined()
  })
})

describe('#popPostLoginRedirect', () => {
  test('returns and clears a role-agnostic stashed target regardless of the login role', () => {
    const yar = fakeYar()
    yar.set('postLoginRedirect', {
      target: '/work-items/123',
      nonce: 'n1',
      role: null
    })
    const request = { yar }
    expect(
      popPostLoginRedirect(request, ROLE_SUPPORT_READONLY, '/work-items')
    ).toBe('/work-items/123')
    expect(yar.get('postLoginRedirect')).toBeUndefined()
  })

  test('returns the target when the login role matches the stashed required role', () => {
    const yar = fakeYar()
    yar.set('postLoginRedirect', {
      target: '/work-items/123/assign',
      nonce: 'n1',
      role: ROLE_STANDARD
    })
    const request = { yar }
    expect(popPostLoginRedirect(request, ROLE_STANDARD, '/work-items')).toBe(
      '/work-items/123/assign'
    )
  })

  // Reviewer-flagged regression: a signed-out visitor to a role-scoped GET
  // (e.g. GET /backend-status requires support-readonly) who then signs in
  // as the *other* role must land on '/work-items', not get bounced
  // straight into a 403 by replaying a stash their session can't access.
  test('falls back when the login role does not match the stashed required role', () => {
    const yar = fakeYar()
    yar.set('postLoginRedirect', {
      target: '/backend-status',
      nonce: 'n1',
      role: ROLE_SUPPORT_READONLY
    })
    const request = { yar }
    expect(popPostLoginRedirect(request, ROLE_STANDARD, '/work-items')).toBe(
      '/work-items'
    )
    expect(yar.get('postLoginRedirect')).toBeUndefined()
  })

  test('returns the fallback when nothing was stashed', () => {
    const request = { yar: fakeYar() }
    expect(popPostLoginRedirect(request, ROLE_STANDARD, '/work-items')).toBe(
      '/work-items'
    )
  })

  test('returns the fallback for a protocol-relative stashed value (open-redirect guard)', () => {
    const yar = fakeYar()
    yar.set('postLoginRedirect', {
      target: '//evil.example',
      nonce: 'n1',
      role: null
    })
    const request = { yar }
    expect(popPostLoginRedirect(request, ROLE_STANDARD, '/work-items')).toBe(
      '/work-items'
    )
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
    expect(loginRedirect.headers.location).toMatch(
      /^\/auth\/regulator\/login\?rt=/
    )
    const rt = new URL(
      loginRedirect.headers.location,
      'http://localhost'
    ).searchParams.get('rt')

    let cookies = extractCookies(loginRedirect.headers)
    expect(cookies.session).toBeTruthy()

    // Follow the redirect chain exactly as a browser would: GET the stub
    // login page with the rt query string still attached, which is what
    // confirms the stash (see confirmPostLoginRedirect) before it can be
    // consumed. A fresh request/cookie jar here (the injectWithCrumb test
    // helper's default behaviour) would mint a new session and lose it.
    const loginPage = await server.inject({
      method: 'GET',
      url: `/auth/stub/login?rt=${rt}`,
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

  // Regression guard for the exact bug this caught in CI: a user is
  // bounced to login from a page they never actually sign in from (they
  // abandon it), then *separately* logs in later in the same browser
  // session — e.g. by navigating straight to /auth/regulator/login. That
  // unrelated login must not silently resume the abandoned one.
  test('does not replay a stash from an abandoned login into a later, unrelated one', async () => {
    const loginRedirect = await server.inject({
      method: 'GET',
      url: '/test-requires-login?foo=bar'
    })
    const cookies = extractCookies(loginRedirect.headers)

    // The user never follows the rt-bearing redirect above — instead they
    // (or a later, separate action) land on the login page directly, with
    // no rt in the query string.
    const loginPage = await server.inject({
      method: 'GET',
      url: '/auth/stub/login',
      headers: { cookie: cookieHeader(cookies) }
    })
    const mergedCookies = { ...cookies, ...extractCookies(loginPage.headers) }
    const crumb = loginPage.result.match(/name="crumb" value="([^"]+)"/)[1]

    const stubLogin = await server.inject({
      method: 'POST',
      url: '/auth/stub/login',
      headers: { cookie: cookieHeader(mergedCookies) },
      payload: { nation: '', crumb }
    })

    expect(stubLogin.headers.location).toBe('/work-items')
  })
})

// The suite above runs under isTest's 'test-bypass' auth scheme, which
// authenticates every request — it can never produce a genuine 401 on a
// scope-guarded route, so it can't exercise the role-mismatch fallback.
// This suite forces isTest: false so stubAuthPlugin registers the real
// yar-session scheme instead (still stub-login, but with real cookie-based
// session and scope checks — same technique used in controller.test.js's
// "session revocation (real yar-session scheme)" suite), and hits the
// actual GET /backend-status route (requireSupportReadonly).
describe('post-login redirect (end-to-end, real yar-session scheme)', () => {
  let server
  const originalConfigGet = config.get.bind(config)

  beforeAll(async () => {
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'isTest') {
        return false
      }
      return originalConfigGet(key)
    })
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    vi.restoreAllMocks()
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

  // Reviewer-flagged regression: GET /backend-status requires
  // support-readonly; a signed-out visitor to it who then signs in as a
  // *standard* caseworker must land on '/work-items', not get bounced into
  // a 403 by replaying a stash their new session can't access.
  test('does not replay a support-readonly-scoped stash into a standard login', async () => {
    const loginRedirect = await server.inject({
      method: 'GET',
      url: '/backend-status'
    })
    expect(loginRedirect.statusCode).toBe(statusCodes.redirect)
    expect(loginRedirect.headers.location).toMatch(
      /^\/auth\/regulator\/login\?rt=/
    )
    const cookies = extractCookies(loginRedirect.headers)

    const loginPage = await server.inject({
      method: 'GET',
      url: loginRedirect.headers.location.replace(
        '/auth/regulator/login',
        '/auth/stub/login'
      ),
      headers: { cookie: cookieHeader(cookies) }
    })
    const mergedCookies = { ...cookies, ...extractCookies(loginPage.headers) }
    const crumb = loginPage.result.match(/name="crumb" value="([^"]+)"/)[1]

    // Logging in as a standard caseworker (the default POST payload — no
    // loginAs=support) must not resume the support-readonly-scoped target.
    const stubLogin = await server.inject({
      method: 'POST',
      url: '/auth/stub/login',
      headers: { cookie: cookieHeader(mergedCookies) },
      payload: { nation: '', crumb }
    })

    expect(stubLogin.statusCode).toBe(statusCodes.redirect)
    expect(stubLogin.headers.location).toBe('/work-items')
  })

  test('does replay a support-readonly-scoped stash into a support-readonly login', async () => {
    const loginRedirect = await server.inject({
      method: 'GET',
      url: '/backend-status'
    })
    const cookies = extractCookies(loginRedirect.headers)

    const loginPage = await server.inject({
      method: 'GET',
      url: loginRedirect.headers.location.replace(
        '/auth/regulator/login',
        '/auth/stub/login'
      ),
      headers: { cookie: cookieHeader(cookies) }
    })
    const mergedCookies = { ...cookies, ...extractCookies(loginPage.headers) }
    const crumb = loginPage.result.match(/name="crumb" value="([^"]+)"/)[1]

    const stubLogin = await server.inject({
      method: 'POST',
      url: '/auth/stub/login',
      headers: { cookie: cookieHeader(mergedCookies) },
      payload: { nation: '', loginAs: 'support', crumb }
    })

    expect(stubLogin.statusCode).toBe(statusCodes.redirect)
    expect(stubLogin.headers.location).toBe('/backend-status')
  })
})
