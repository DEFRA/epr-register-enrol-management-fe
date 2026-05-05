import { createRemoteJWKSet, jwtVerify } from 'jose'

// Cache JWKS sets per JWKS URI so we don't fetch on every request and so the
// underlying jose cache (with rate-limiting and stale fallback) is reused.
const jwksCache = new Map()

function getJwks(jwksUri) {
  let jwks = jwksCache.get(jwksUri)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri))
    jwksCache.set(jwksUri, jwks)
  }
  return jwks
}

/**
 * Verify an Azure Entra ID id_token.
 *
 * Performs full RFC 7519 / OpenID Connect validation:
 *   - signature (against tenant JWKS)
 *   - issuer (`iss`) matches the tenant issuer
 *   - audience (`aud`) matches our client id
 *   - expiry (`exp`) and not-before (`nbf`) are honoured by jose
 *   - `iat` is present
 *   - `nonce` claim matches the nonce we generated at /authorize time
 *
 * Returns the verified claims on success, throws on any failure.
 */
export async function verifyAzureIdToken(
  idToken,
  { jwksUri, issuer, audience, expectedNonce }
) {
  const jwks = getJwks(jwksUri)
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer,
    audience
  })
  if (typeof payload.iat !== 'number') {
    throw new Error('id_token missing iat claim')
  }
  if (!expectedNonce || payload.nonce !== expectedNonce) {
    throw new Error('id_token nonce mismatch')
  }
  return payload
}

// Test-only: clear the JWKS cache between tests.
export function _clearJwksCache() {
  jwksCache.clear()
}
