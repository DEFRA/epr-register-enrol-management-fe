import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto'
import { fetch as undiciFetch } from 'undici'

import { config } from '#/config/config.js'
import { getAzureEntraIdConfig } from '#/server/common/helpers/auth/providers/azure-entra-id.js'
import { verifyAzureIdToken } from '#/server/common/helpers/auth/providers/azure-id-token.js'
import {
  ROLE_ASSIGN,
  ROLE_STANDARD
} from '#/server/common/helpers/auth/auth-scopes.js'

const LOGIN_PATH = '/auth/regulator/login'

function base64url(buf) {
  return buf
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function defaultRandomToken(bytes = 32) {
  return base64url(nodeRandomBytes(bytes))
}

function pkceChallenge(verifier) {
  return base64url(createHash('sha256').update(verifier).digest())
}

function logWarn(request, msg, data) {
  // hapi-pino exposes request.logger; guard for tests that build a bare
  // request object without one.
  request.logger?.warn?.(data ?? {}, msg)
}

/**
 * Build the auth controllers. Dependencies are injected so tests can swap
 * fetch and the id_token verifier without monkey-patching globals.
 */
export function createAuthControllers({
  fetchImpl = undiciFetch,
  verifyIdToken = verifyAzureIdToken,
  randomToken = defaultRandomToken,
  getProviderConfig = () => getAzureEntraIdConfig(config)
} = {}) {
  function regulatorLoginController(request, h) {
    const provider = getProviderConfig()
    const state = randomToken()
    const nonce = randomToken()
    const codeVerifier = randomToken(64)
    const codeChallenge = pkceChallenge(codeVerifier)

    request.yar.set('oauthState', state)
    request.yar.set('oauthNonce', nonce)
    request.yar.set('pkceVerifier', codeVerifier)

    // Ensure the OIDC scopes are present even if config is misconfigured.
    const scopeSet = new Set([
      'openid',
      'profile',
      'email',
      ...(provider.scopes ?? [])
    ])

    const params = new URLSearchParams({
      client_id: provider.clientId,
      response_type: 'code',
      redirect_uri: provider.callbackUrl,
      scope: [...scopeSet].join(' '),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    })

    return h.redirect(`${provider.authUrl}?${params}`)
  }

  async function regulatorCallbackController(request, h) {
    const { code, state } = request.query
    const storedState = request.yar.get('oauthState')
    const storedNonce = request.yar.get('oauthNonce')
    const storedVerifier = request.yar.get('pkceVerifier')

    if (!code || !state || state !== storedState) {
      logWarn(request, 'oauth callback: state mismatch or missing code', {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        stateMatches: state === storedState
      })
      return h.redirect(LOGIN_PATH)
    }

    request.yar.clear('oauthState')
    request.yar.clear('oauthNonce')
    request.yar.clear('pkceVerifier')

    if (!storedNonce || !storedVerifier) {
      logWarn(
        request,
        'oauth callback: missing nonce or pkce verifier in session'
      )
      return h.redirect(LOGIN_PATH)
    }

    const provider = getProviderConfig()

    let tokenJson
    try {
      const tokenResponse = await fetchImpl(provider.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: provider.callbackUrl,
          code_verifier: storedVerifier
        })
      })

      if (!tokenResponse.ok) {
        const body = await tokenResponse.text().catch(() => '')
        let azureError
        try {
          azureError = JSON.parse(body)?.error
        } catch {
          azureError = undefined
        }
        logWarn(request, 'oauth callback: token endpoint returned non-2xx', {
          status: tokenResponse.status,
          azureError
        })
        return h.redirect(LOGIN_PATH)
      }

      tokenJson = await tokenResponse.json()
    } catch (err) {
      logWarn(request, 'oauth callback: token endpoint request failed', {
        err: err?.message
      })
      return h.redirect(LOGIN_PATH)
    }

    const idToken = tokenJson?.id_token
    if (!idToken) {
      logWarn(request, 'oauth callback: token response missing id_token')
      return h.redirect(LOGIN_PATH)
    }

    let claims
    try {
      claims = await verifyIdToken(idToken, {
        jwksUri: provider.jwksUri,
        issuer: provider.issuer,
        audience: provider.clientId,
        expectedNonce: storedNonce
      })
    } catch (err) {
      logWarn(request, 'oauth callback: id_token verification failed', {
        err: err?.message
      })
      return h.redirect(LOGIN_PATH)
    }

    const user = {
      id: claims.oid ?? claims.sub,
      email: claims.preferred_username ?? claims.email ?? null,
      name: claims.name ?? null,
      // Real role assignment will come from group claims / a directory
      // lookup. For PoC purposes every signed-in regulator gets the
      // standard role; preserve that behaviour.
      roles: [ROLE_STANDARD]
    }

    // Reset the session before storing the authenticated user to defeat
    // session-fixation: any pre-login session id (which an attacker might
    // know) is discarded, and a fresh session id is bound to the user.
    request.yar.reset()
    request.yar.set('user', user)
    return h.redirect('/')
  }

  function logoutController(request, h) {
    request.yar.clear('user')
    return h.redirect(LOGIN_PATH)
  }

  return {
    regulatorLoginController,
    regulatorCallbackController,
    logoutController
  }
}

// Default instances used by the route plugin.
const defaults = createAuthControllers()
export const regulatorLoginController = defaults.regulatorLoginController
export const regulatorCallbackController = defaults.regulatorCallbackController
export const logoutController = defaults.logoutController

// Re-exported for test / route convenience
export const ROLES = { ROLE_STANDARD, ROLE_ASSIGN }
