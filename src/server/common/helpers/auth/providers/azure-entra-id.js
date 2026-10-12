import { fetch as undiciFetch } from 'undici'

// RA-537: the Entra ID OAuth endpoints (authorize, token, JWKS, issuer,
// end-session) are read from an OpenID Connect discovery document rather
// than hand-built, so the same code talks to the real Microsoft service or
// to the Entra ID stub used by the automated tests on test/perf-test.
//
// ENTRA_DISCOVERY_URL points at the document. When it is blank the real
// Microsoft v2.0 document for ENTRA_TENANT_ID is used, whose endpoints are
// the ones this module used to hard-code — so environments that only set
// the tenant keep working unchanged.

const DISCOVERY_TIMEOUT_MS = 10_000

const REQUIRED_DISCOVERY_FIELDS = [
  'authorization_endpoint',
  'token_endpoint',
  'jwks_uri',
  'issuer',
  'end_session_endpoint'
]

// Discovery documents are effectively static; cache the parsed endpoints
// per URL for the life of the process. Failures are never cached, so a
// transient outage recovers on the next sign-in attempt.
const endpointCache = new Map()

export function getEntraDiscoveryUrl(config) {
  const discoveryUrl = config.get('auth.azureEntraId.discoveryUrl')
  if (discoveryUrl) {
    return discoveryUrl
  }
  const tenantId = config.get('auth.azureEntraId.tenantId')
  if (!tenantId) {
    return ''
  }
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0/.well-known/openid-configuration`
}

/**
 * True when Entra ID sign-in can be offered: a client id plus somewhere to
 * discover the endpoints from (an explicit discovery URL, or a tenant to
 * derive the Microsoft one from). Drives the hybrid-mode routes, the stub
 * login page's "Sign in with Entra ID" button and the assignee directory.
 */
export function isEntraIdConfigured(config) {
  return Boolean(
    config.get('auth.azureEntraId.clientId') && getEntraDiscoveryUrl(config)
  )
}

export function getAzureEntraIdConfig(config) {
  return {
    discoveryUrl: getEntraDiscoveryUrl(config),
    scopes: ['openid', 'profile', 'email'],
    clientId: config.get('auth.azureEntraId.clientId'),
    clientSecret: config.get('auth.azureEntraId.clientSecret'),
    callbackUrl: `${config.get('auth.callbackBaseUrl')}/auth/regulator/callback`
  }
}

/**
 * Fetch (or return cached) endpoints from an OIDC discovery document.
 * Uses undici's fetch so the CDP forward proxy (setup-proxy.js) applies.
 *
 * `issuer` is taken from the document itself — never derived from the
 * URL the document was fetched from. The Entra ID stub is fetched over an
 * internal URL but issues tokens under its external URL.
 */
export async function getAzureEntraIdEndpoints(
  discoveryUrl,
  { fetchImpl = undiciFetch } = {}
) {
  if (!discoveryUrl) {
    throw new Error(
      'Entra ID discovery URL is not configured (ENTRA_DISCOVERY_URL or ENTRA_TENANT_ID)'
    )
  }
  const cached = endpointCache.get(discoveryUrl)
  if (cached) {
    return cached
  }

  const response = await fetchImpl(discoveryUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`Entra ID OIDC discovery failed: ${response.status}`)
  }
  const doc = await response.json()
  const missing = REQUIRED_DISCOVERY_FIELDS.filter(
    (field) => typeof doc?.[field] !== 'string' || doc[field] === ''
  )
  if (missing.length > 0) {
    throw new Error(
      `Entra ID OIDC discovery document missing: ${missing.join(', ')}`
    )
  }

  const endpoints = Object.freeze({
    authUrl: doc.authorization_endpoint,
    tokenUrl: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
    issuer: doc.issuer,
    logoutUrl: doc.end_session_endpoint
  })
  endpointCache.set(discoveryUrl, endpoints)
  return endpoints
}

/**
 * The full provider description the auth controllers use: static client
 * config plus the discovered endpoints. Rejects when discovery fails.
 */
export async function resolveAzureEntraIdProvider(config, options) {
  const provider = getAzureEntraIdConfig(config)
  const endpoints = await getAzureEntraIdEndpoints(
    provider.discoveryUrl,
    options
  )
  return { ...provider, ...endpoints }
}

// Test-only: clear the discovery cache between tests.
export function _clearEntraEndpointCache() {
  endpointCache.clear()
}
