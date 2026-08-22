import hapi from '@hapi/hapi'
import { vi, describe, test, expect, beforeAll, afterAll } from 'vitest'

import { statusCodes } from '../../constants/status-codes.js'

vi.mock('#/config/config.js', () => ({
  config: { get: vi.fn() }
}))

const { config } = await import('#/config/config.js')
const { basicAuthPlugin, basicAuthExcludedPaths, basicAuthExcludedPrefixes } =
  await import('./basic-auth-plugin.js')

const validAuthHeader =
  'Basic ' + Buffer.from('test:test123').toString('base64')

const makeServer = async () => {
  const server = hapi.server()
  await server.register(basicAuthPlugin)
  server.route({
    method: 'GET',
    path: '/test',
    options: { auth: false },
    handler: () => 'ok'
  })
  await server.initialize()
  return server
}

describe('#basicAuthPlugin', () => {
  describe('when basicEnabled is true', () => {
    let server

    beforeAll(async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth.basicEnabled') {
          return true
        }
        if (key === 'auth.basicUsr') {
          return 'test'
        }
        if (key === 'auth.basicPasswd') {
          return 'test123'
        }
      })
      server = await makeServer()
    })

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test('returns 401 with WWW-Authenticate when no Authorization header', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/test'
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
      expect(headers['www-authenticate']).toBe('Basic realm="Secure"')
    })

    test('returns 401 when Authorization header is not Basic scheme', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: { authorization: 'Bearer sometoken' }
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
    })

    test('returns 401 for unknown username', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {
          authorization:
            'Basic ' + Buffer.from('nobody:test123').toString('base64')
        }
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
    })

    test('returns 401 for wrong password', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {
          authorization:
            'Basic ' + Buffer.from('test:wrongpassword').toString('base64')
        }
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
    })

    test('allows request through with valid credentials', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: { authorization: validAuthHeader }
      })
      expect(statusCode).toBe(statusCodes.ok)
    })

    // A Base64-encoded string with no colon has no valid username/password
    // split point. Without an explicit guard the decoded string would be
    // treated as the username with an empty password, which passes silently
    // to safeCompare. We reject early instead to keep the logic explicit.
    test('returns 401 for a credential string with no colon separator', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {
          authorization:
            'Basic ' + Buffer.from('nocolonhere').toString('base64')
        }
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
    })
  })

  // Timing attacks exploit the fact that a naive string comparison (===)
  // short-circuits on the first mismatched character, so a credential that
  // shares more characters with the real one takes fractionally longer to
  // reject. With enough samples an attacker can infer the secret one character
  // at a time. crypto.timingSafeEqual always takes the same amount of time
  // regardless of where the values diverge, removing that signal.
  //
  // Network jitter makes this hard to exploit in practice against this app, but
  // constant-time comparison is the correct form for any credential check and
  // is cheap to apply — so we do it to avoid reasoning about whether ambient
  // noise is sufficient protection in any given deployment.
  //
  // Both username and password comparisons run unconditionally (no short-circuit
  // &&) so an attacker cannot use a timing difference on the username check to
  // infer that the username alone was correct.
  describe('constant-time credential comparison', () => {
    let server

    beforeAll(async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth.basicEnabled') {
          return true
        }
        if (key === 'auth.basicUsr') {
          return 'test'
        }
        if (key === 'auth.basicPasswd') {
          return 'test123'
        }
      })
      server = await makeServer()
    })

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    // A credential that shares a prefix with the real one must be rejected just
    // as firmly as one that shares nothing. If short-circuit comparison were
    // used, the near-match would return faster — that difference is the timing
    // signal. These tests confirm the authentication decision is correct; the
    // constant-time property itself is guaranteed by crypto.timingSafeEqual.
    test('rejects a username that is a prefix of the real username', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {
          authorization:
            'Basic ' + Buffer.from('tes:test123').toString('base64')
        }
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
    })

    test('rejects a password that is a prefix of the real password', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {
          authorization:
            'Basic ' + Buffer.from('test:test12').toString('base64')
        }
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
    })

    test('rejects credentials that are a superset of the real ones', async () => {
      // Ensures length is checked — timingSafeEqual requires equal-length
      // buffers, so we must not skip the length check and accidentally allow
      // a longer-but-otherwise-matching credential through.
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {
          authorization:
            'Basic ' + Buffer.from('test:test123extra').toString('base64')
        }
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
    })

    test('accepts credentials that match exactly', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: { authorization: validAuthHeader }
      })
      expect(statusCode).toBe(statusCodes.ok)
    })
  })

  // The WWW-Authenticate realm is returned on every 401 response and is visible
  // to any unauthenticated caller — including attackers. A descriptive realm
  // like "Application" or the app name confirms that Basic Auth is in use and
  // may hint at the technology stack. A generic realm ("Secure") still satisfies
  // RFC 7235 (browsers need it to label the credential prompt) without leaking
  // anything actionable.
  //
  // WWW_AUTHENTICATE is intentionally not exported from the plugin — it is an
  // implementation detail. Tests assert the value via the HTTP response header
  // rather than importing the constant, so the public API stays minimal.
  describe('WWW-Authenticate header', () => {
    let server

    beforeAll(async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth.basicEnabled') {
          return true
        }
        if (key === 'auth.basicUsr') {
          return 'test'
        }
        if (key === 'auth.basicPasswd') {
          return 'test123'
        }
      })
      server = await makeServer()
    })

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test('uses a generic realm that does not identify the application', async () => {
      const { headers } = await server.inject({ method: 'GET', url: '/test' })
      expect(headers['www-authenticate']).toBe('Basic realm="Secure"')
      expect(headers['www-authenticate']).not.toMatch(/application/i)
    })

    test('is returned on a request with no Authorization header', async () => {
      const { headers } = await server.inject({ method: 'GET', url: '/test' })
      expect(headers['www-authenticate']).toBe('Basic realm="Secure"')
    })

    test('is returned on a request with invalid credentials', async () => {
      const { headers } = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {
          authorization:
            'Basic ' + Buffer.from('wrong:creds').toString('base64')
        }
      })
      expect(headers['www-authenticate']).toBe('Basic realm="Secure"')
    })
  })

  describe('basicAuthExcludedPaths', () => {
    test('contains /health', () => {
      expect(basicAuthExcludedPaths).toContain('/health')
    })

    test('contains /favicon.ico', () => {
      expect(basicAuthExcludedPaths).toContain('/favicon.ico')
    })

    test('contains the OIDC callback route', () => {
      expect(basicAuthExcludedPaths).toContain('/auth/regulator/callback')
    })

    // Exported as a frozen array so no import site can accidentally push to it
    // and silently widen the bypass. Object.freeze makes that intent enforceable
    // at runtime rather than just conventional.
    test('is frozen to prevent external mutation', () => {
      expect(Object.isFrozen(basicAuthExcludedPaths)).toBe(true)
    })

    test('throws when an external caller attempts to push a new path', () => {
      expect(() => basicAuthExcludedPaths.push('/secret')).toThrow(TypeError)
    })
  })

  describe('basicAuthExcludedPrefixes', () => {
    test('contains /public/ to cover static assets', () => {
      expect(basicAuthExcludedPrefixes).toContain('/public/')
    })

    test('is frozen to prevent external mutation', () => {
      expect(Object.isFrozen(basicAuthExcludedPrefixes)).toBe(true)
    })

    test('throws when an external caller attempts to push a new prefix', () => {
      expect(() => basicAuthExcludedPrefixes.push('/other/')).toThrow(TypeError)
    })
  })

  describe('when basicEnabled is true and an excluded path is requested', () => {
    let server

    beforeAll(async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth.basicEnabled') {
          return true
        }
        if (key === 'auth.basicUsr') {
          return 'test'
        }
        if (key === 'auth.basicPasswd') {
          return 'test123'
        }
      })
      server = hapi.server()
      await server.register(basicAuthPlugin)
      basicAuthExcludedPaths.forEach((path) => {
        server.route({
          method: 'GET',
          path,
          options: { auth: false },
          handler: () => 'ok'
        })
      })
      server.route({
        method: 'GET',
        path: '/gated',
        options: { auth: false },
        handler: () => 'ok'
      })
      await server.initialize()
    })

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test.each(basicAuthExcludedPaths)(
      'allows %s through without Authorization header',
      async (path) => {
        const { statusCode } = await server.inject({ method: 'GET', url: path })
        expect(statusCode).toBe(statusCodes.ok)
      }
    )

    test('still requires Authorization on non-excluded paths', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/gated'
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
    })
  })

  describe('when basicEnabled is true and a prefix-excluded path is requested', () => {
    let server

    beforeAll(async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth.basicEnabled') {
          return true
        }
        if (key === 'auth.basicUsr') {
          return 'test'
        }
        if (key === 'auth.basicPasswd') {
          return 'test123'
        }
      })
      server = hapi.server()
      await server.register(basicAuthPlugin)
      server.route({
        method: 'GET',
        path: '/public/{param*}',
        options: { auth: false },
        handler: () => 'ok'
      })
      server.route({
        method: 'GET',
        path: '/gated',
        options: { auth: false },
        handler: () => 'ok'
      })
      await server.initialize()
    })

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test('allows a nested static asset path through without Authorization header', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/public/assets/app.js'
      })
      expect(statusCode).toBe(statusCodes.ok)
    })

    test('allows a top-level /public/ path through without Authorization header', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/public/favicon.ico'
      })
      expect(statusCode).toBe(statusCodes.ok)
    })

    test('still requires Authorization on non-prefixed paths', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/gated'
      })
      expect(statusCode).toBe(statusCodes.unauthorized)
    })
  })

  describe('when basicEnabled is true but credentials are empty', () => {
    test('throws at registration time when username is empty', async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth.basicEnabled') {
          return true
        }
        if (key === 'auth.basicUsr') {
          return ''
        }
        if (key === 'auth.basicPasswd') {
          return 'test123'
        }
      })
      const server = hapi.server()
      await expect(server.register(basicAuthPlugin)).rejects.toThrow(
        'Basic auth enabled but username or password not set in config'
      )
    })

    test('throws at registration time when password is empty', async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth.basicEnabled') {
          return true
        }
        if (key === 'auth.basicUsr') {
          return 'test'
        }
        if (key === 'auth.basicPasswd') {
          return ''
        }
      })
      const server = hapi.server()
      await expect(server.register(basicAuthPlugin)).rejects.toThrow(
        'Basic auth enabled but username or password not set in config'
      )
    })

    test('throws at registration time when both username and password are empty', async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth.basicEnabled') {
          return true
        }
        if (key === 'auth.basicUsr') {
          return ''
        }
        if (key === 'auth.basicPasswd') {
          return ''
        }
      })
      const server = hapi.server()
      await expect(server.register(basicAuthPlugin)).rejects.toThrow(
        'Basic auth enabled but username or password not set in config'
      )
    })
  })

  describe('when basicEnabled is false', () => {
    let server

    beforeAll(async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth.basicEnabled') {
          return false
        }
      })
      server = await makeServer()
    })

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test('allows requests through without any Authorization header', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/test'
      })
      expect(statusCode).toBe(statusCodes.ok)
    })
  })
})
