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
      url: '/'
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

  test('default test user has assign role', async () => {
    const { request } = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(request.auth.credentials.roles).toContain('assign')
    expect(request.auth.credentials.roles).toContain('standard')
  })

  test('x-test-user-role=standard header switches credentials', async () => {
    const { request } = await server.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-test-user-role': 'standard' }
    })

    expect(request.auth.credentials.roles).toEqual(['standard'])
  })

  test('stub login GET returns the chooser page', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/stub/login'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Stub Login'))
  })

  test('stub login POST without selection returns 400', async () => {
    const { statusCode } = await injectWithCrumb(server, {
      method: 'POST',
      url: '/auth/stub/login',
      payload: {}
    })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('stub login POST with valid user redirects to /', async () => {
    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: '/auth/stub/login',
      payload: { role: 'standard' }
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/')
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

describe('Entra ID button visibility', () => {
  let entraServer

  beforeAll(async () => {
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'auth.azureEntraId.clientId') return 'test-client-id'
      if (key === 'auth.azureEntraId.tenantId') return 'Defradev.onmicrosoft.com'
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
