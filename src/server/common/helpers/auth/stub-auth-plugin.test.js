import hapi from '@hapi/hapi'

import {
  stubAuthPlugin,
  TEST_ASSIGN_USER,
  TEST_STANDARD_USER
} from './stub-auth-plugin.js'

async function buildServer() {
  const server = hapi.server()
  await server.register(stubAuthPlugin)
  server.route({
    method: 'GET',
    path: '/whoami',
    handler: (request) => ({
      id: request.auth.credentials.id,
      roles: request.auth.credentials.roles
    })
  })
  return server
}

describe('stubAuthPlugin (NODE_ENV=test bypass scheme)', () => {
  test('defaults to TEST_ASSIGN_USER when no header is sent', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/whoami' })
    expect(res.statusCode).toBe(200)
    expect(res.result.id).toBe(TEST_ASSIGN_USER.id)
  })

  test("accepts x-test-user-role 'standard'", async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-test-user-role': 'standard' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.result.id).toBe(TEST_STANDARD_USER.id)
  })

  test("accepts x-test-user-role 'assign'", async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-test-user-role': 'assign' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.result.id).toBe(TEST_ASSIGN_USER.id)
  })

  test('rejects unknown x-test-user-role with 400', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-test-user-role': 'garbage' }
    })
    expect(res.statusCode).toBe(400)
    expect(res.result.message).toMatch(/x-test-user-role/)
    expect(res.result.message).toMatch(/garbage/)
  })
})
