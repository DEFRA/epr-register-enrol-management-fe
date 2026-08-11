import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'
import { config } from '#/config/config.js'

const realConfigGet = config.get.bind(config)

describe('auth', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('protected routes are accessible to authenticated test users', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
  })

  test('health endpoint is publicly accessible (auth: false)', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/health'
    })

    expect(statusCode).toBe(statusCodes.ok)
  })

  test('default test user has the standard caseworker role', async () => {
    const { request } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(request.auth.credentials.roles).toEqual(['standard'])
  })

  test('x-test-user-role=standard header switches credentials', async () => {
    const { request } = await server.inject({
      method: 'GET',
      url: '/work-items',
      headers: { 'x-test-user-role': 'standard' }
    })

    expect(request.auth.credentials.roles).toEqual(['standard'])
  })

  test('root path redirects to work items', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/work-items')
  })

  test('stub login GET returns the chooser page', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/stub/login'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Stub Login'))
  })

  test('stub login POST redirects to /work-items', async () => {
    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: '/auth/stub/login',
      payload: {}
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/work-items')
  })

  // RA-335.
  test('stub login GET offers a support user option', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: '/auth/stub/login'
    })

    expect(result).toEqual(
      expect.stringContaining('data-testid="stub-support-login"')
    )
  })

  test('stub login POST with loginAs=support redirects to /work-items', async () => {
    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: '/auth/stub/login',
      payload: { loginAs: 'support' }
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/work-items')
  })

  test('x-test-user-role=support-readonly header switches credentials', async () => {
    const { request } = await server.inject({
      method: 'GET',
      url: '/work-items',
      headers: { 'x-test-user-role': 'support-readonly' }
    })

    expect(request.auth.credentials.roles).toEqual(['support-readonly'])
  })

  test('a support user is rejected (403) from a mutating route', async () => {
    const { statusCode } = await injectWithCrumb(server, {
      method: 'POST',
      url: '/work-items/some-id/self-assign',
      headers: { 'x-test-user-role': 'support-readonly' },
      payload: {}
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  // RA-335: these 5 routes had NO scope check at all before RA-335 — any
  // authenticated session, including a future read-only support user,
  // could reach them. route-scope-coverage.test.js proves the route
  // table is configured correctly (static); these prove Hapi actually
  // enforces it at request time (runtime) — the two are not the same
  // guarantee, and this is the regression the fix exists to prevent.
  test.each([
    ['complete task', '/work-items/some-id/tasks/some-task/complete'],
    ['set task status', '/work-items/some-id/tasks/some-task/status'],
    ['apply action', '/work-items/some-id/actions/some-action'],
    ['withdraw confirm', '/work-items/some-id/actions/withdraw/confirm']
  ])(
    'a support user is rejected (403) from the previously-ungated %s route',
    async (_name, url) => {
      const { statusCode } = await injectWithCrumb(server, {
        method: 'POST',
        url,
        headers: { 'x-test-user-role': 'support-readonly' },
        payload: {}
      })

      expect(statusCode).toBe(statusCodes.forbidden)
    }
  )

  test('a support user is rejected (403) from the previously-ungated submit query route', async () => {
    // /work-items/{id}/query only accepts
    // application/x-www-form-urlencoded (unlike the other 4 previously-
    // ungated routes) — a JSON payload 415s before auth even runs, which
    // would make this pass for the wrong reason.
    const { statusCode } = await injectWithCrumb(server, {
      method: 'POST',
      url: '/work-items/some-id/query',
      headers: {
        'x-test-user-role': 'support-readonly',
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: ''
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('regulator login (stub mode) redirects to stub chooser', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/regulator/login'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/auth/stub/login')
  })

  test('logout redirects to regulator login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/logout'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/auth/regulator/login')
  })
})

// RA-306 (AC03). The browser must not be able to redraw a case management
// page from its back/forward cache after sign out — it has to refetch, so
// that the destroyed session bounces it to sign-in.
describe('no-store on authenticated responses', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('an authenticated page response is marked no-store', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['cache-control']).toBe('no-store')
    expect(headers.pragma).toBe('no-cache')
    expect(headers.expires).toBe('0')
  })

  test('an authenticated redirect is marked no-store', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(statusCode).toBe(302)
    expect(headers['cache-control']).toBe('no-store')
  })

  test('an authenticated error page is marked no-store', async () => {
    // A 403 on a real (authenticated) route: the Boom goes through
    // catchAll, which swaps it for a rendered view. Proves the extension
    // ordering in server.js still covers the final response.
    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: '/work-items/some-id/self-assign',
      headers: { 'x-test-user-role': 'support-readonly' },
      payload: {}
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(headers['cache-control']).toBe('no-store')
  })

  test('a 404 for an unrouted URL is left alone (auth never ran)', async () => {
    // No route matched, so there is no authenticated user and no user
    // data in the response — nothing to protect from the cache.
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/definitely-not-a-route'
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(headers['cache-control']).not.toBe('no-store')
  })

  test('static assets stay cacheable', async () => {
    const { headers } = await server.inject({
      method: 'GET',
      url: '/favicon.ico'
    })

    expect(headers['cache-control']).not.toBe('no-store')
    expect(headers.pragma).toBeUndefined()
  })

  test('the sign-in page is not forced to no-store', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/stub/login'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['cache-control']).not.toBe('no-store')
  })
})

describe('Entra ID button visibility', () => {
  let entraServer

  beforeAll(async () => {
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'auth.azureEntraId.clientId') return 'test-client-id'
      if (key === 'auth.azureEntraId.tenantId') {
        return 'Defradev.onmicrosoft.com'
      }
      return realConfigGet(key)
    })
    entraServer = await createServer()
    await entraServer.initialize()
  })

  afterAll(async () => {
    await entraServer?.stop({ timeout: 0 })
    vi.restoreAllMocks()
  })

  test('shows Entra ID button when credentials are configured', async () => {
    const { result, statusCode } = await entraServer.inject({
      method: 'GET',
      url: '/auth/stub/login'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('data-testid="entra-id-login"')
  })

  test('Entra ID routes are registered when credentials are configured', async () => {
    const { statusCode } = await entraServer.inject({
      method: 'GET',
      url: '/auth/regulator/entra-id'
    })

    // regulatorLoginController redirects to Azure — any non-404 means the route exists
    expect(statusCode).not.toBe(statusCodes.notFound)
  })
})

describe('Entra ID button absent without credentials', () => {
  let plainServer

  beforeAll(async () => {
    plainServer = await createServer()
    await plainServer.initialize()
  })

  afterAll(async () => {
    await plainServer?.stop({ timeout: 0 })
  })

  test('does not show Entra ID button when credentials are not set', async () => {
    const { result, statusCode } = await plainServer.inject({
      method: 'GET',
      url: '/auth/stub/login'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toContain('data-testid="entra-id-login"')
  })
})
