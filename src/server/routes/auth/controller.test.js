import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createAuthControllers } from './controller.js'

function makeRequest({ query = {}, session = {} } = {}) {
  const order = []
  const yar = {
    _store: { ...session },
    get: vi.fn(function (k) {
      order.push(['get', k])
      return this._store[k]
    }),
    set: vi.fn(function (k, v) {
      order.push(['set', k])
      this._store[k] = v
    }),
    clear: vi.fn(function (k) {
      order.push(['clear', k])
      delete this._store[k]
    }),
    reset: vi.fn(function () {
      order.push(['reset'])
      this._store = {}
    })
  }
  const logger = { warn: vi.fn() }
  return { request: { query, yar, logger }, yar, logger, order }
}

const h = {
  redirect: vi.fn((target) => ({ redirected: target }))
}

const provider = {
  authUrl: 'https://login.example/authorize',
  tokenUrl: 'https://login.example/token',
  jwksUri: 'https://login.example/jwks',
  issuer: 'https://login.example/v2.0',
  scopes: ['openid', 'profile', 'email'],
  clientId: 'client-id',
  clientSecret: 'client-secret',
  callbackUrl: 'https://app.example/auth/regulator/callback'
}

let counter
const randomToken = vi.fn(() => `token-${++counter}`)

beforeEach(() => {
  counter = 0
  randomToken.mockClear()
  h.redirect.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function buildOk({ verifyIdToken, fetchImpl } = {}) {
  return createAuthControllers({
    fetchImpl,
    verifyIdToken,
    randomToken,
    getProviderConfig: () => provider
  })
}

describe('regulatorLoginController', () => {
  test('stores state, nonce, pkce verifier and builds authorize URL with PKCE S256', () => {
    const { request, yar } = makeRequest()
    const { regulatorLoginController } = buildOk()

    const result = regulatorLoginController(request, h)

    expect(yar.set).toHaveBeenCalledWith('oauthState', 'token-1')
    expect(yar.set).toHaveBeenCalledWith('oauthNonce', 'token-2')
    expect(yar.set).toHaveBeenCalledWith('pkceVerifier', 'token-3')

    const url = result.redirected
    expect(url).toMatch(/^https:\/\/login\.example\/authorize\?/)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('client_id')).toBe('client-id')
    expect(params.get('response_type')).toBe('code')
    expect(params.get('state')).toBe('token-1')
    expect(params.get('nonce')).toBe('token-2')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/)
    // PKCE challenge is base64url(sha256(verifier)), length 43.
    expect(params.get('code_challenge').length).toBe(43)
    expect(params.get('scope').split(' ').sort()).toEqual([
      'email',
      'openid',
      'profile'
    ])
  })
})

describe('regulatorCallbackController', () => {
  test('rejects when state does not match stored state', async () => {
    const { request, logger } = makeRequest({
      query: { code: 'c', state: 'forged' },
      session: { oauthState: 'real', oauthNonce: 'n', pkceVerifier: 'v' }
    })
    const fetchImpl = vi.fn()
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken: vi.fn()
    })

    const result = await regulatorCallbackController(request, h)

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.redirected).toBe('/auth/regulator/login')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stateMatches: false }),
      expect.stringContaining('state mismatch')
    )
  })

  test('sends PKCE code_verifier in the token request body', async () => {
    const { request } = makeRequest({
      query: { code: 'auth-code', state: 's' },
      session: {
        oauthState: 's',
        oauthNonce: 'n',
        pkceVerifier: 'verifier-xyz'
      }
    })
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { id_token: 'id.tok.en' }
      },
      async text() {
        return ''
      }
    }))
    const verifyIdToken = vi.fn(async () => ({
      oid: 'u1',
      preferred_username: 'a@b',
      name: 'Alice',
      nonce: 'n'
    }))
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken
    })

    await regulatorCallbackController(request, h)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, opts] = fetchImpl.mock.calls[0]
    const body = new URLSearchParams(opts.body.toString())
    expect(body.get('code_verifier')).toBe('verifier-xyz')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code')
  })

  test('rejects when id_token verification fails (signature/aud/iss/exp/nonce)', async () => {
    const { request, logger } = makeRequest({
      query: { code: 'c', state: 's' },
      session: { oauthState: 's', oauthNonce: 'n', pkceVerifier: 'v' }
    })
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { id_token: 'bad' }
      },
      async text() {
        return ''
      }
    }))
    const verifyIdToken = vi.fn(async () => {
      throw new Error('signature verification failed')
    })
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken
    })

    const result = await regulatorCallbackController(request, h)

    expect(verifyIdToken).toHaveBeenCalledWith(
      'bad',
      expect.objectContaining({
        jwksUri: provider.jwksUri,
        issuer: provider.issuer,
        audience: provider.clientId,
        expectedNonce: 'n'
      })
    )
    expect(result.redirected).toBe('/auth/regulator/login')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'signature verification failed' }),
      expect.stringContaining('id_token verification failed')
    )
  })

  test('rejects when nonce in id_token does not match stored nonce (via verifier contract)', async () => {
    // The verifier (azure-id-token.js) is responsible for the nonce check.
    // The controller passes expectedNonce through; assert the verifier sees
    // the stored nonce, and that a verifier-thrown nonce error is handled
    // the same as any other verification failure.
    const { request, logger } = makeRequest({
      query: { code: 'c', state: 's' },
      session: {
        oauthState: 's',
        oauthNonce: 'expected-nonce',
        pkceVerifier: 'v'
      }
    })
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { id_token: 'tok' }
      },
      async text() {
        return ''
      }
    }))
    const verifyIdToken = vi.fn(async (_t, opts) => {
      // Simulate the real verifier's nonce check.
      if (opts.expectedNonce !== 'wrong') {
        throw new Error('id_token nonce mismatch')
      }
      return {}
    })
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken
    })

    const result = await regulatorCallbackController(request, h)

    expect(verifyIdToken).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({ expectedNonce: 'expected-nonce' })
    )
    expect(result.redirected).toBe('/auth/regulator/login')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'id_token nonce mismatch' }),
      expect.stringContaining('id_token verification failed')
    )
  })

  test('resets session before storing the authenticated user', async () => {
    const { request, yar, order } = makeRequest({
      query: { code: 'c', state: 's' },
      session: { oauthState: 's', oauthNonce: 'n', pkceVerifier: 'v' }
    })
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { id_token: 't' }
      },
      async text() {
        return ''
      }
    }))
    const verifyIdToken = vi.fn(async () => ({
      oid: 'oid-1',
      preferred_username: 'r@d',
      name: 'Reg'
    }))
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken
    })

    const result = await regulatorCallbackController(request, h)

    expect(yar.reset).toHaveBeenCalled()
    expect(yar.set).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({
        id: 'oid-1',
        email: 'r@d',
        name: 'Reg',
        roles: ['standard']
      })
    )
    // reset() must occur before set('user', ...).
    const resetIdx = order.findIndex(([op]) => op === 'reset')
    const setUserIdx = order.findIndex(
      ([op, k]) => op === 'set' && k === 'user'
    )
    expect(resetIdx).toBeGreaterThanOrEqual(0)
    expect(setUserIdx).toBeGreaterThan(resetIdx)
    expect(result.redirected).toBe('/')
  })

  test('logs warn with status code when token endpoint returns non-2xx', async () => {
    const { request, logger } = makeRequest({
      query: { code: 'c', state: 's' },
      session: { oauthState: 's', oauthNonce: 'n', pkceVerifier: 'v' }
    })
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      async text() {
        return JSON.stringify({ error: 'invalid_client' })
      }
    }))
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken: vi.fn()
    })

    const result = await regulatorCallbackController(request, h)

    expect(result.redirected).toBe('/auth/regulator/login')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, azureError: 'invalid_client' }),
      expect.stringContaining('token endpoint returned non-2xx')
    )
  })

  test('does not call Microsoft Graph /me — identity comes from id_token only', async () => {
    const { request } = makeRequest({
      query: { code: 'c', state: 's' },
      session: { oauthState: 's', oauthNonce: 'n', pkceVerifier: 'v' }
    })
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { id_token: 't', access_token: 'a' }
      },
      async text() {
        return ''
      }
    }))
    const verifyIdToken = vi.fn(async () => ({
      oid: 'oid',
      preferred_username: 'x@y',
      name: 'X'
    }))
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken
    })

    await regulatorCallbackController(request, h)

    // Exactly one outbound fetch (the token endpoint); never Graph.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe(provider.tokenUrl)
  })
})
