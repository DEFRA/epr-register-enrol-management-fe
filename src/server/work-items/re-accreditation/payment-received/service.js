/**
 * Re-accreditation payment-received service (RA-523).
 *
 * Owns the single-step "an operator answered the query on a duly-made
 * application, and that answer carried the payment" flow: the item leaves
 * `updated` and goes STRAIGHT to assessment, rather than back to
 * `duly-made` for a second "Payment received" click.
 *
 * Deliberately shaped as a near-twin of `continue-review/service.js`, and
 * that likeness is the point rather than an accident to be refactored away:
 * both are one-shot, body-less onward hops out of `updated` whose target
 * the backend resolves, and reading them side by side should make the ONE
 * difference obvious — which origin they serve.
 *
 * There is deliberately NO payment date in the request. It was captured at
 * duly-make and is already on the payload; re-collecting it here would let
 * two different dates describe one payment.
 *
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }                            on success.
 *  - { ok: false, outcome: 'conflict' | 'forbidden' | 'not-found' |
 *      'invalid' | 'server' | 'network' | 'unauthorized',
 *      status?, message }                              on failure.
 *
 * `conflict` is the interesting one: the backend answers 409 when the item
 * is not in `updated`, when its origin is not `duly-made`, or when its
 * template snapshot has not been migrated to the version carrying this
 * transition. All three mean "not from here", which is what the banner says.
 *
 * Constructor takes a lazy backend-client getter so tests can stub the
 * call without mocking `undici`.
 */

import { toOutcome } from '../../core/backend-outcome.js'

async function defaultPaymentReceived(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.paymentReceivedReAccreditation(args)
}

export function createPaymentReceivedService({
  paymentReceived = defaultPaymentReceived
} = {}) {
  return {
    /**
     * Move a re-accreditation work item on from `updated` to assessment,
     * recording that the query response carried the payment.
     */
    async recordPaymentReceived({ workItemId, user = null }) {
      if (typeof workItemId !== 'string' || workItemId.trim() === '') {
        throw new Error('workItemId must be a non-empty string')
      }

      const result = await paymentReceived({ workItemId, user })

      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }

      return {
        ok: false,
        outcome: toOutcome(result.reason),
        status: result.status,
        message: result.message ?? 'Recording payment received failed'
      }
    }
  }
}
