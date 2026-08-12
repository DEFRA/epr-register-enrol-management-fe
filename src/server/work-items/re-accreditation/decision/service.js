/**
 * Re-accreditation decision service (RA-410).
 *
 * Owns the "log the outcome" flow that replaced RA-132's approve
 * interstitial. One method, one backend call, both outcomes.
 *
 * ⚠ ONE CALL, NOT TWO. The underlying lifecycle is two hops
 * (`assessment-in-progress` -> `awaiting-decision` -> `approved`/`rejected`)
 * but management-be applies both inside `POST /work-items/re-accreditation/{id}/decision`
 * as a single atomic write. Do not reintroduce a `submit-for-decision` call
 * here: a failure between the two would leave a terminal decision unrecorded
 * with the item parked in a state the UI no longer offers a button for.
 * Neither hop is caller-invocable any more in any case (see `module.js`).
 *
 * The approve path still runs through the backend's
 * `ReAccreditationApprovalService`, so accreditation-id generation, the
 * start date, the SLA-clock stop, the publishing audit entry and the
 * decision notification all still happen exactly as they did under RA-132.
 * Nothing about approval was reimplemented here — only the route in.
 *
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }
 *  - { ok: false, outcome, status?, errorCode?, message }
 *
 * ⚠ Two different things are called "outcome" in this file and they are not
 * the same. The `outcome` ARGUMENT is the decision the case worker made
 * (`'approved'` | `'rejected'`). The `outcome` FIELD on a failure result is
 * the framework's error classification (`'conflict'`, `'invalid'`, …), the
 * same vocabulary every other module service returns. Renaming either would
 * break a convention; they simply collide.
 *
 * `errorCode` mirrors the `/duly-make` vocabulary so the controller can bind
 * a 400 straight to the radio group instead of a page-level banner.
 *
 * Constructor takes a lazy backend-client getter so tests can stub the call
 * without mocking `undici`.
 */

import { toOutcome } from '../../core/backend-outcome.js'
import { isValidDecisionOutcome } from './eligibility.js'

async function defaultRecordDecision(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.recordReAccreditationDecision(args)
}

export function createDecisionService({
  recordDecision = defaultRecordDecision
} = {}) {
  return {
    /**
     * Record a decision against a re-accreditation work item.
     *
     * @param {object} args
     * @param {string} args.workItemId
     * @param {string} args.outcome `'approved'` or `'rejected'`. The WIRE
     *   value — never the display label. "Refused" is what the radio says;
     *   `rejected` is what goes over the wire and what the backend's
     *   unchanged `reject` transition and notification templates key on.
     */
    async recordWorkItemDecision({ workItemId, outcome, user = null }) {
      if (typeof workItemId !== 'string' || workItemId.trim() === '') {
        throw new Error('workItemId must be a non-empty string')
      }

      // Validated here as well as in the controller because this is a public
      // service method: a future caller that skips the form must not be able
      // to post an arbitrary string to the backend. Returns a result rather
      // than throwing, so the controller renders a field error either way.
      if (!isValidDecisionOutcome(outcome)) {
        return {
          ok: false,
          outcome: 'invalid',
          errorCode: 'invalid-outcome',
          message: 'Select the decision for this application.'
        }
      }

      const result = await recordDecision({ workItemId, outcome, user })

      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }

      return {
        ok: false,
        outcome: toOutcome(result.reason),
        status: result.status,
        errorCode: result.errorCode ?? null,
        message: result.message ?? 'Recording the decision failed'
      }
    }
  }
}
