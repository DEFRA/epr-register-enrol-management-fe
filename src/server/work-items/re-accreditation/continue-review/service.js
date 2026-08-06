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
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }                            on success, which
 *      includes the backend's idempotent replay (the item had already
 *      left `updated` into a valid continue target).
 *  - { ok: false, outcome: 'conflict' | 'forbidden' | 'not-found' |
 *      'invalid' | 'server' | 'network' | 'unauthorized',
 *      status?, message }                              on failure.
 *
 * Constructor takes a lazy backend-client getter so tests can stub the
 * call without mocking `undici`.
 */

async function defaultContinueReview(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.continueReviewReAccreditation(args)
}

export function createContinueReviewService({
  continueReview = defaultContinueReview
} = {}) {
  return {
    /**
     * Move a re-accreditation work item on from `updated` to the state its
     * query was raised from.
     */
    async continueReviewOfWorkItem({ workItemId, user = null }) {
      if (typeof workItemId !== 'string' || workItemId.trim() === '') {
        throw new Error('workItemId must be a non-empty string')
      }

      const result = await continueReview({ workItemId, user })

      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }

      return {
        ok: false,
        outcome: CONTINUE_REVIEW_OUTCOME[result.reason] ?? 'server',
        status: result.status,
        message: result.message ?? 'Continue review failed'
      }
    }
  }
}

const CONTINUE_REVIEW_OUTCOME = {
  invalid: 'invalid',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  'not-found': 'not-found',
  conflict: 'conflict',
  server: 'server',
  network: 'network'
}
