/**
 * Re-accreditation confirm-contact service (RA-527, step 2 of the two-step
 * determination).
 *
 * One method, one backend call. The determination was made at step 1; this
 * is what applies it, once the regulator has contacted the applicant.
 * management-be pushes the final status to the operator journey first and
 * writes nothing if that fails, so a failure here means nothing changed and
 * the regulator can simply try again.
 *
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }   on success, including the backend's idempotent
 *    replay for an item already applied.
 *  - { ok: false, outcome, status?, message }
 *
 * Constructor takes a lazy backend-client getter so tests can stub the call
 * without mocking `undici`.
 */

import { toOutcome } from '../../core/backend-outcome.js'

async function defaultConfirmContact(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.confirmApplicantContact(args)
}

export function createConfirmContactService({
  confirmContact = defaultConfirmContact
} = {}) {
  return {
    /**
     * Confirm the applicant has been contacted about the determination,
     * which applies it.
     */
    async confirmApplicantContact({ workItemId, user = null }) {
      if (typeof workItemId !== 'string' || workItemId.trim() === '') {
        throw new Error('workItemId must be a non-empty string')
      }

      const result = await confirmContact({ workItemId, user })

      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }

      return {
        ok: false,
        outcome: toOutcome(result.reason),
        status: result.status,
        message: result.message ?? 'Confirming applicant contact failed'
      }
    }
  }
}
