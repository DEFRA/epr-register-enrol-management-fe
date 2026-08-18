import hapi from '@hapi/hapi'
import Yar from '@hapi/yar'

import { authPlugin } from './auth-plugin.js'

async function buildServer() {
  const server = hapi.server()
  await server.register([
    { plugin: Yar, options: { cookieOptions: { password: 'x'.repeat(32) } } }
  ])
  await server.register(authPlugin)
  server.route({
    method: 'GET',
    path: '/whoami',
    handler: (request) => request.auth.credentials
  })
  server.route({
    method: 'GET',
    path: '/public',
    options: { auth: false },
    handler: () => 'ok'
  })
  return server
}

describe('authPlugin (production yar-session scheme)', () => {
  test('rejects a request with no session user', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/whoami' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/^\/auth\/regulator\/login/)
  })

  test('authenticates a request carrying a yar session user, mapping roles onto scope', async () => {
    const server = await buildServer()
    server.ext('onPreAuth', (request, h) => {
      request.yar.set('user', {
        id: 'user-1',
        name: 'Test User',
        roles: ['standard']
      })
      return h.continue
    })

    const res = await server.inject({ method: 'GET', url: '/whoami' })

    expect(res.statusCode).toBe(200)
    expect(res.result).toMatchObject({
      id: 'user-1',
      name: 'Test User',
      roles: ['standard'],
      scope: ['standard']
    })
  })

  test('defaults scope to an empty array when the session user has no roles', async () => {
    const server = await buildServer()
    server.ext('onPreAuth', (request, h) => {
      request.yar.set('user', { id: 'user-2', name: 'No Roles' })
      return h.continue
    })

    const res = await server.inject({ method: 'GET', url: '/whoami' })

    expect(res.statusCode).toBe(200)
    expect(res.result.scope).toEqual([])
  })

  test('routes opting out with auth: false are unaffected', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/public' })
    expect(res.statusCode).toBe(200)
    expect(res.result).toBe('ok')
  })

  test('sets `session` as the default authentication strategy', async () => {
    const server = await buildServer()
    // No explicit `auth` option on the route above — it only gets protected
    // if `session` was registered as the default strategy.
    const res = await server.inject({ method: 'GET', url: '/whoami' })
    expect(res.statusCode).toBe(302)
  })
})
