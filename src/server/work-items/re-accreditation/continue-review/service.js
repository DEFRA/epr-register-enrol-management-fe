/**
 * Re-accreditation continue-review service (RA-372).
 *
 * Owns the single-step "carry the application on from `updated`" flow: a
 * query was raised, the operator responded, the case worker has looked at
 * the response, and the application now needs to go back to the stage it
 * was queried from so the remaining tasks can be finished there.
 *
 * There is deliberately no input beyond the work item id. The backend
 * resolves which `continue-review-during-*` transition applies from the
 * work item's own audit history; the caller neither chooses nor predicts
 * the target state.
 *
 * RA-523 note: this no longer serves the `duly-made` origin. An item
 * queried while it awaited payment now goes straight to assessment via
 * `../payment-received/`. The transition is untouched and the backend
 * still honours it — only the CTA moved — so this service is unchanged in
 * behaviour and still handles the other three origins.
 *
 * The behaviour lives in `../onward-hop.js`, shared with that flow; what
 * stays here is what differs.
 *
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }                            on success, which
 *      includes the backend's idempotent replay (the item had already
 *      left `updated` into a valid continue target).
 *  - { ok: false, outcome, status?, message }          on failure.
 *
 * Constructor takes a lazy backend-client getter so tests can stub the
 * call without mocking `undici`.
 */

import { createOnwardHopCall } from '../onward-hop.js'

async function defaultContinueReview(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.continueReviewReAccreditation(args)
}

export function createContinueReviewService({
  continueReview = defaultContinueReview
} = {}) {
  const apply = createOnwardHopCall({
    call: continueReview,
    failureMessage: 'Continue review failed'
  })

  return {
    /**
     * Move a re-accreditation work item on from `updated` to the state its
     * query was raised from.
     */
    continueReviewOfWorkItem: apply
  }
}
