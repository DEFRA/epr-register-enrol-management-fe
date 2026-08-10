/**
 * Shared translation from a backend-client `reason` to a service-object
 * `outcome` (RA-372).
 *
 * The backend clients in `common/helpers/backend-api/backend-api.js`
 * return `{ ok: false, reason }` where `reason` is derived from the HTTP
 * status. Module service objects re-expose that to their controllers as
 * `outcome`, so a controller can branch on the failure without parsing
 * status codes.
 *
 * The mapping is currently an identity allow-list — the point is not to
 * rename anything but to CLOSE the set, so a `reason` the frontend has
 * never heard of degrades to `'server'` (a generic "try again" banner)
 * rather than reaching a controller's `switch` as an unhandled value and
 * silently falling through to whatever the last branch happens to be.
 *
 * It lives here rather than being copy-pasted per module because two
 * copies drift: when the backend adds a reason, exactly one file should
 * need editing, otherwise two services quietly disagree about the same
 * HTTP response.
 */

const KNOWN_OUTCOMES = new Set([
  'invalid',
  'unauthorized',
  'forbidden',
  'not-found',
  'conflict',
  'server',
  'network'
])

const FALLBACK_OUTCOME = 'server'

/**
 * Map a backend-client `reason` onto a service-object `outcome`.
 *
 * @param {string} [reason] `reason` from a backend-api failure result.
 * @returns {string} A known outcome, or `'server'` for anything else.
 */
export function toOutcome(reason) {
  return KNOWN_OUTCOMES.has(reason) ? reason : FALLBACK_OUTCOME
}

// Exported for testability — production code goes through `toOutcome()`.
export { KNOWN_OUTCOMES, FALLBACK_OUTCOME }
