/**
 * Re-accreditation payment-received service (RA-523).
 *
 * Owns the single-step "an operator answered the query on a duly-made
 * application, and that answer carried the payment" flow: the item leaves
 * `updated` and goes STRAIGHT to assessment, rather than back to
 * `duly-made` for a second click on a control the case worker already
 * skipped once.
 *
 * There is deliberately NO payment date in the request. It was captured at
 * duly-make and already sits on the payload; re-collecting it here would
 * let two different dates describe one payment.
 *
 * The behaviour lives in `../onward-hop.js`, shared with Continue review —
 * see that file for why the two are one implementation and not two copies.
 * What stays here is what differs: the backend call, the intent-named
 * method, and the fallback message.
 *
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }
 *  - { ok: false, outcome, status?, message }
 *
 * `conflict` is the interesting failure: the backend answers 409 when the
 * item is not in `updated`, when its origin is not `duly-made`, or when
 * its template snapshot predates v14. All three mean "not from here".
 *
 * Constructor takes a lazy backend-client getter so tests can stub the
 * call without mocking `undici`.
 */

import { createOnwardHopCall } from '../onward-hop.js'

async function defaultPaymentReceived(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.paymentReceivedReAccreditation(args)
}

export function createPaymentReceivedService({
  paymentReceived = defaultPaymentReceived
} = {}) {
  const apply = createOnwardHopCall({
    call: paymentReceived,
    failureMessage: 'Recording payment received failed'
  })

  return {
    /**
     * Move a re-accreditation work item on from `updated` to assessment,
     * recording that the query response carried the payment.
     */
    recordPaymentReceived: apply
  }
}
