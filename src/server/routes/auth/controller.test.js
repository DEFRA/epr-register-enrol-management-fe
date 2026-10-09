import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

import { createAuthControllers, loggedOutController } from './controller.js'
import { config } from '#/config/config.js'
import { _clearEntraEndpointCache } from '#/server/common/helpers/auth/providers/azure-entra-id.js'
import { _clearJwksCache } from '#/server/common/helpers/auth/providers/azure-id-token.js'

const REQUIRED_ROLE = config.get('auth.azureEntraId.regulatorRoleValue')
const SUPPORT_ROLE = config.get('auth.azureEntraId.supportUserRoleValue')

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
  redirect: vi.fn((target) => ({ redirected: target })),
  view: vi.fn((path, ctx) => {
    const sealed = { viewPath: path, viewCtx: ctx, statusCode: undefined }
    sealed.code = (status) => {
      sealed.statusCode = status
      return sealed
    }
    return sealed
  })
}

const provider = {
  authUrl: 'https://login.example/authorize',
  tokenUrl: 'https://login.example/token',
  jwksUri: 'https://login.example/jwks',
  issuer: 'https://login.example/v2.0',
  logoutUrl: 'https://login.example/logout',
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
  h.view.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function buildOk({
  verifyIdToken,
  fetchImpl,
  syncAssignableUser = vi.fn(async () => {}),
  desyncAssignableUser = vi.fn(async () => {})
} = {}) {
  return createAuthControllers({
    fetchImpl,
    verifyIdToken,
    randomToken,
    getProviderConfig: () => provider,
    syncAssignableUser,
    desyncAssignableUser
  })
}

describe('regulatorLoginController', () => {
  test('stores state, nonce, pkce verifier and builds authorize URL with PKCE S256', async () => {
    const { request, yar } = makeRequest()
    const { regulatorLoginController } = buildOk()

    const result = await regulatorLoginController(request, h)

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
      nonce: 'n',
      roles: [REQUIRED_ROLE]
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
      expect.objectContaining({
        err: expect.objectContaining({
          message: 'signature verification failed'
        })
      }),
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
      expect.objectContaining({
        err: expect.objectContaining({ message: 'id_token nonce mismatch' })
      }),
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
      name: 'Reg',
      roles: [REQUIRED_ROLE]
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
    expect(result.redirected).toBe('/work-items')
  })

  test('rejects when the id_token roles claim is missing the required regulator role', async () => {
    const { request, yar, logger } = makeRequest({
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
      name: 'Reg',
      roles: ['SomeOtherRole']
    }))
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken
    })

    const result = await regulatorCallbackController(request, h)

    expect(result.viewPath).toBe('error/index')
    expect(result.statusCode).toBe(403)
    expect(yar.set).not.toHaveBeenCalledWith('user', expect.anything())
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        regulatorRole: REQUIRED_ROLE,
        supportUserRole: SUPPORT_ROLE
      }),
      expect.stringContaining('missing required regulator or support user role')
    )
  })

  // RA-446: the neither-role branch is the normal shape of an offboarding
  // / access-review revocation (the app role removed outright, not swapped
  // for the support-user role) — without desyncing here too, a caller who
  // loses access this way stays in the assignable-users directory for the
  // full inactivity window despite failing login on every attempt.
  test('removes the caller from the assignable-users directory when neither role is present', async () => {
    const { request } = makeRequest({
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
      name: 'Reg',
      roles: ['SomeOtherRole']
    }))
    const syncAssignableUser = vi.fn(async () => {})
    const desyncAssignableUser = vi.fn(async () => {})
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken,
      syncAssignableUser,
      desyncAssignableUser
    })

    const result = await regulatorCallbackController(request, h)

    expect(result.statusCode).toBe(403)
    expect(desyncAssignableUser).toHaveBeenCalledWith('oid-1')
    expect(syncAssignableUser).not.toHaveBeenCalled()
  })

  test('still returns the access-denied page when the directory desync fails on a neither-role login', async () => {
    const { request, logger } = makeRequest({
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
      name: 'Reg',
      roles: ['SomeOtherRole']
    }))
    const desyncAssignableUser = vi.fn(async () => {
      throw new Error('redis unavailable')
    })
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken,
      desyncAssignableUser
    })

    const result = await regulatorCallbackController(request, h)

    expect(result.viewPath).toBe('error/index')
    expect(result.statusCode).toBe(403)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'redis unavailable' })
      }),
      expect.stringContaining('assignable-user directory sync failed')
    )
  })

  test('grants a support-readonly session when the id_token roles claim has the support user role', async () => {
    const { request, yar } = makeRequest({
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
      oid: 'oid-support',
      preferred_username: 's@d',
      name: 'Support',
      roles: [SUPPORT_ROLE]
    }))
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken
    })

    const result = await regulatorCallbackController(request, h)

    expect(result.redirected).toBe('/work-items')
    expect(yar.set).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({
        id: 'oid-support',
        roles: ['support-readonly']
      })
    )
  })

  // RA-446: keep the real-Entra-ID assignable-users directory in sync with
  // the same role check login already performs.
  test('upserts the caller into the assignable-users directory on a regulator-role login', async () => {
    const { request } = makeRequest({
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
      name: 'Reg',
      roles: [REQUIRED_ROLE]
    }))
    const syncAssignableUser = vi.fn(async () => {})
    const desyncAssignableUser = vi.fn(async () => {})
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken,
      syncAssignableUser,
      desyncAssignableUser
    })

    await regulatorCallbackController(request, h)

    expect(syncAssignableUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'oid-1', email: 'r@d', name: 'Reg' })
    )
    expect(desyncAssignableUser).not.toHaveBeenCalled()
  })

  test('removes the caller from the assignable-users directory on a support-readonly login', async () => {
    const { request } = makeRequest({
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
      oid: 'oid-support',
      preferred_username: 's@d',
      name: 'Support',
      roles: [SUPPORT_ROLE]
    }))
    const syncAssignableUser = vi.fn(async () => {})
    const desyncAssignableUser = vi.fn(async () => {})
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken,
      syncAssignableUser,
      desyncAssignableUser
    })

    await regulatorCallbackController(request, h)

    expect(desyncAssignableUser).toHaveBeenCalledWith('oid-support')
    expect(syncAssignableUser).not.toHaveBeenCalled()
  })

  test('login still succeeds when the assignable-users directory write fails', async () => {
    const { request, yar, logger } = makeRequest({
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
      name: 'Reg',
      roles: [REQUIRED_ROLE]
    }))
    const syncAssignableUser = vi.fn(async () => {
      throw new Error('redis unavailable')
    })
    const { regulatorCallbackController } = buildOk({
      fetchImpl,
      verifyIdToken,
      syncAssignableUser
    })

    const result = await regulatorCallbackController(request, h)

    expect(result.redirected).toBe('/work-items')
    expect(yar.set).toHaveBeenCalledWith('user', expect.anything())
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'redis unavailable' })
      }),
      expect.stringContaining('assignable-user directory sync failed')
    )
  })

  test('rejects when the id_token has no roles claim at all', async () => {
    const { request, yar } = makeRequest({
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

    expect(result.viewPath).toBe('error/index')
    expect(result.statusCode).toBe(403)
    expect(yar.set).not.toHaveBeenCalledWith('user', expect.anything())
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
      name: 'X',
      roles: [REQUIRED_ROLE]
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

// RA-306.
describe('logoutController', () => {
  test('destroys the whole session, not just the user key (AC01/AC02)', async () => {
    const { request, yar } = makeRequest({
      session: {
        user: { id: 'oid', roles: ['standard'] },
        workItemsFilters: { status: 'open' }
      }
    })
    const { logoutController } = buildOk()

    await logoutController(request, h)

    expect(yar.reset).toHaveBeenCalledTimes(1)
    // clear('user') would have left the rest of the session (and the
    // session id) intact — that is the bug this replaced.
    expect(yar.clear).not.toHaveBeenCalled()
    expect(yar._store).toEqual({})
  })

  // RA-449.
  test('redirects to the logged-out page rather than straight to Entra ID', async () => {
    const { request } = makeRequest({ session: { user: { id: 'oid' } } })
    const { logoutController } = buildOk()

    await logoutController(request, h)

    expect(h.redirect).toHaveBeenCalledWith('/auth/logged-out')
  })

  test('resets the session before redirecting', async () => {
    const { request, order } = makeRequest({ session: { user: { id: 'a' } } })
    const { logoutController } = buildOk()

    await logoutController(request, h)

    // The idToken and user lookups are reads that must happen before reset()
    // wipes them (user.id feeds the RA-462 registry cleanup), but they are
    // read-only and don't affect the RA-306 guarantee that reset() runs
    // before anything is redirected.
    expect(order).toEqual([['get', 'idToken'], ['get', 'user'], ['reset']])
  })

  test('is safe to call when there is no session to destroy', async () => {
    const { request, yar } = makeRequest()
    const { logoutController } = buildOk()

    await expect(logoutController(request, h)).resolves.toBeDefined()
    expect(yar.reset).toHaveBeenCalledTimes(1)
    expect(h.redirect).toHaveBeenCalledWith('/auth/logged-out')
  })

  // RA-437.
  test('ends the Entra ID session too when signed in via real Entra ID', async () => {
    const { request, yar } = makeRequest({
      session: { user: { id: 'oid' }, idToken: 'the-entra-id-token' }
    })
    const { logoutController } = buildOk()

    await logoutController(request, h)

    expect(yar.reset).toHaveBeenCalledTimes(1)
    expect(h.redirect).toHaveBeenCalledTimes(1)
    const [redirectUrl] = h.redirect.mock.calls[0]
    const url = new URL(redirectUrl)

    expect(url.origin + url.pathname).toBe(provider.logoutUrl)
    expect(url.searchParams.get('id_token_hint')).toBe('the-entra-id-token')
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'http://localhost:3000/auth/logout'
    )
  })

  test('reads the id_token before resetting the session, then resets before redirecting', async () => {
    const { request, order } = makeRequest({
      session: { user: { id: 'oid' }, idToken: 'the-entra-id-token' }
    })
    const { logoutController } = buildOk()

    await logoutController(request, h)

    // RA-462: `user` is also read before reset() to feed the best-effort
    // registry cleanup — read-only, and still ahead of reset().
    expect(order).toEqual([['get', 'idToken'], ['get', 'user'], ['reset']])
  })

  // RA-437: post_logout_redirect_uri must be /auth/logout — that's the
  // only URL registered in the Entra app registration's allowed logout
  // redirect list. This proves the round trip through it doesn't
  // reopen RA-449: by the time Entra redirects back to /auth/logout, the
  // session (and its id_token) is already gone, so the second pass falls
  // through to a plain local sign-out instead of looping back to Entra.
  test('a second hit to /auth/logout, as Entra redirects back to, lands on the interstitial rather than looping back to Entra', async () => {
    const { request: firstRequest } = makeRequest({
      session: { user: { id: 'oid' }, idToken: 'the-entra-id-token' }
    })
    const { logoutController } = buildOk()

    await logoutController(firstRequest, h)
    h.redirect.mockClear()

    // Entra redirects the browser back to /auth/logout — a fresh request,
    // with no session left (the reset() above already cleared it).
    const { request: secondRequest } = makeRequest()

    await logoutController(secondRequest, h)

    expect(h.redirect).toHaveBeenCalledWith('/auth/logged-out')
  })
})

// RA-449.
describe('loggedOutController', () => {
  test('renders the logged-out view', () => {
    const { request } = makeRequest()

    const result = loggedOutController(request, h)

    expect(h.view).toHaveBeenCalledWith('auth/logged-out', {
      pageTitle: 'You have been signed out',
      loginPath: '/auth/regulator/login'
    })
    expect(result.viewPath).toBe('auth/logged-out')
  })
})

// RA-537: endpoints come from the Entra ID discovery document.
describe('Entra ID discovery failures', () => {
  const discoveryDown = () =>
    createAuthControllers({
      randomToken,
      getProviderConfig: vi.fn(async () => {
        throw new Error('Entra ID OIDC discovery failed: 503')
      })
    })

  test('login responds 502 (generic error page) rather than redirecting back to itself', async () => {
    const { request } = makeRequest()
    const { regulatorLoginController } = discoveryDown()

    await expect(regulatorLoginController(request, h)).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 502 }
    })
    expect(h.redirect).not.toHaveBeenCalled()
  })

  test('callback redirects to login without calling the token endpoint', async () => {
    const { request, logger } = makeRequest({
      query: { code: 'c', state: 's' },
      session: { oauthState: 's', oauthNonce: 'n', pkceVerifier: 'v' }
    })
    const fetchImpl = vi.fn()
    const { regulatorCallbackController } = createAuthControllers({
      fetchImpl,
      getProviderConfig: vi.fn(async () => {
        throw new Error('Entra ID OIDC discovery failed: 503')
      })
    })

    const result = await regulatorCallbackController(request, h)

    expect(result.redirected).toBe('/auth/regulator/login')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Entra ID discovery failed')
    )
  })

  test('logout still ends the local session and lands on the logged-out page', async () => {
    const { request, yar, logger } = makeRequest({
      session: { user: { id: 'oid' }, idToken: 'the-entra-id-token' }
    })
    const { logoutController } = discoveryDown()

    await logoutController(request, h)

    expect(yar.reset).toHaveBeenCalledTimes(1)
    expect(h.redirect).toHaveBeenCalledWith('/auth/logged-out')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Entra ID discovery failed')
    )
  })
})

// RA-537: the default wiring against an Entra ID stub-shaped discovery
// document, with the real id_token verifier. The stub is fetched over an
// internal URL but issues tokens under its external URL, so the issuer
// must come from the document, never from the URL it was fetched from.
describe('Entra ID sign-in via a discovery document (default wiring)', () => {
  const INTERNAL = 'http://entra-stub:3200'
  const EXTERNAL = 'http://localhost:3200'
  const DISCOVERY_URL = `${INTERNAL}/.well-known/openid-configuration`
  const discoveryDoc = {
    issuer: EXTERNAL,
    authorization_endpoint: `${EXTERNAL}/authorize`,
    token_endpoint: `${INTERNAL}/token`,
    jwks_uri: `${INTERNAL}/.well-known/jwks.json`,
    end_session_endpoint: `${EXTERNAL}/logout`
  }
  const keys = {
    clientId: config.get('auth.azureEntraId.clientId'),
    clientSecret: config.get('auth.azureEntraId.clientSecret'),
    discoveryUrl: config.get('auth.azureEntraId.discoveryUrl')
  }

  let privateKey

  beforeEach(async () => {
    config.set('auth.azureEntraId.clientId', 'epr-register-enrol-management-fe')
    config.set('auth.azureEntraId.clientSecret', 'stub-client-secret')
    config.set('auth.azureEntraId.discoveryUrl', DISCOVERY_URL)

    const pair = await generateKeyPair('RS256')
    privateKey = pair.privateKey
    const jwk = await exportJWK(pair.publicKey)
    Object.assign(jwk, { kid: 'k1', alg: 'RS256', use: 'sig' })
    // jose fetches the JWKS with the global fetch.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ keys: [jwk] })
      }))
    )
  })

  afterEach(() => {
    config.set('auth.azureEntraId.clientId', keys.clientId)
    config.set('auth.azureEntraId.clientSecret', keys.clientSecret)
    config.set('auth.azureEntraId.discoveryUrl', keys.discoveryUrl)
    vi.unstubAllGlobals()
    _clearEntraEndpointCache()
    _clearJwksCache()
  })

  function idTokenWithIssuer(iss) {
    return new SignJWT({
      nonce: 'n',
      oid: 'oid-1',
      name: 'Reg',
      preferred_username: 'r@d',
      roles: [REQUIRED_ROLE]
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(iss)
      .setAudience('epr-register-enrol-management-fe')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
  }

  function stubFetch(idToken) {
    return vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        url === DISCOVERY_URL ? discoveryDoc : { id_token: idToken },
      text: async () => ''
    }))
  }

  function callbackRequest() {
    return makeRequest({
      query: { code: 'c', state: 's' },
      session: { oauthState: 's', oauthNonce: 'n', pkceVerifier: 'v' }
    })
  }

  test('login redirects to the discovered authorization_endpoint', async () => {
    const fetchImpl = stubFetch()
    const { regulatorLoginController } = createAuthControllers({
      fetchImpl,
      randomToken
    })

    const result = await regulatorLoginController(makeRequest().request, h)

    expect(fetchImpl).toHaveBeenCalledWith(DISCOVERY_URL, expect.anything())
    expect(result.redirected.startsWith(`${EXTERNAL}/authorize?`)).toBe(true)
  })

  test('callback exchanges the code at the discovered token_endpoint and accepts the document issuer', async () => {
    const fetchImpl = stubFetch(await idTokenWithIssuer(EXTERNAL))
    const { regulatorCallbackController } = createAuthControllers({
      fetchImpl,
      syncAssignableUser: vi.fn(async () => {}),
      desyncAssignableUser: vi.fn(async () => {})
    })
    const { request, yar } = callbackRequest()

    const result = await regulatorCallbackController(request, h)

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[1]
    expect(tokenUrl).toBe(`${INTERNAL}/token`)
    expect(tokenInit.body.get('client_secret')).toBe('stub-client-secret')
    expect(result.redirected).toBe('/work-items')
    expect(yar.set).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ id: 'oid-1', roles: ['standard'] })
    )
  })

  test('callback rejects an id_token issued under the URL the document was fetched from', async () => {
    const fetchImpl = stubFetch(await idTokenWithIssuer(INTERNAL))
    const { regulatorCallbackController } = createAuthControllers({
      fetchImpl,
      syncAssignableUser: vi.fn(async () => {}),
      desyncAssignableUser: vi.fn(async () => {})
    })
    const { request, yar, logger } = callbackRequest()

    const result = await regulatorCallbackController(request, h)

    expect(result.redirected).toBe('/auth/regulator/login')
    expect(yar.set).not.toHaveBeenCalledWith('user', expect.anything())
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('id_token verification failed')
    )
  })

  test('logout redirects to the discovered end_session_endpoint', async () => {
    const { logoutController } = createAuthControllers({
      fetchImpl: stubFetch()
    })
    const { request } = makeRequest({
      session: { user: { id: 'oid-1' }, idToken: 'the-id-token' }
    })

    const result = await logoutController(request, h)

    const url = new URL(result.redirected)
    expect(url.origin + url.pathname).toBe(`${EXTERNAL}/logout`)
    expect(url.searchParams.get('id_token_hint')).toBe('the-id-token')
  })
})
