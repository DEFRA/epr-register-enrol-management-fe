import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

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
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/auth/stub/login',
      payload: {}
    })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('stub login POST with valid user redirects to /', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/auth/stub/login',
      payload: { userId: 'stub-standard-1' }
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
