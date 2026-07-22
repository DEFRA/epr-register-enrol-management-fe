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
 * v3 dropped the role-membership field carried by v2 — authorization is
 * entirely this BFF's concern now, so role membership is never forwarded
 * to the backend (see epr-register-enrol-management-be ADR-0005).
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
    sharedSecret = config.get('auth.sharedSecret'),
    timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    nonce = randomBytes(16).toString('base64url')
  } = {}
) {
  if (!sharedSecret) {
    return {}
  }

  const payload = [
    'v3',
    headers['x-cdp-cognito-client-id'] ?? '',
    headers['x-cdp-user-id'] ?? '',
    headers['x-cdp-user-name'] ?? '',
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
