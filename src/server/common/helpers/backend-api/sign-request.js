import { createHmac, randomBytes } from 'node:crypto'

import { config } from '#/config/config.js'

const TIMESTAMP_HEADER = 'x-cdp-auth-timestamp'
const NONCE_HEADER = 'x-cdp-auth-nonce'
const SIGNATURE_HEADER = 'x-cdp-auth-signature'

/**
 * Adds HMAC-SHA256 auth headers to an already-assembled outbound header map.
 *
 * The canonical payload (v3 prefix + identity fields + timestamp + nonce)
 * lets the backend verify the trust headers originated from this BFF.
 * Returns an empty object when no shared secret is configured (local dev).
 *
 * v3 originally dropped the role-membership field carried by v2 (see
 * epr-register-enrol-management-be ADR-0005) — authorization was entirely
 * this BFF's concern. RA-469 puts role (and nation) back into the signed
 * payload: management-be's recycling-operations endpoint enforces AC17
 * authorization server-side too, using the x-cdp-user-role/x-cdp-user-nation
 * headers as its claims, so those two headers need the same signed-integrity
 * guarantee as user-id/user-name — otherwise something able to alter them
 * on an already-signed request could bypass that authorization while the
 * signature still validates. Both fields default to '' when absent, same
 * as user-id/user-name, so every other caller of this function is unaffected.
 *
 * @param {Record<string,string>} headers - assembled outbound headers
 * @param {object} [opts]
 * @param {string} [opts.sharedSecret] - overrides config lookup (tests)
 * @param {string} [opts.timestamp]    - ISO-8601 UTC instant (tests)
 * @param {string} [opts.nonce]        - base64url nonce (tests)
 */
export function signRequestHeaders(
  headers,
  {
    sharedSecret = config.get('backendApi.sharedSecret'),
    timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    nonce = randomBytes(16).toString('base64url')
  } = {}
) {
  if (!sharedSecret) {
    return {}
  }

  const payload = [
    'v3',
    headers['x-cdp-client-id'] ?? '',
    headers['x-cdp-user-id'] ?? '',
    headers['x-cdp-user-name'] ?? '',
    headers['x-cdp-user-role'] ?? '',
    headers['x-cdp-user-nation'] ?? '',
    timestamp,
    nonce
  ].join('\n')

  const signature = createHmac('sha256', sharedSecret)
    .update(payload, 'utf8')
    .digest('base64')

  return {
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: signature
  }
}
