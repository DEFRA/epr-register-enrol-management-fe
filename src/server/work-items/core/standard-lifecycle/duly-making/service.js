/**
 * Standard-lifecycle duly-making service (RA-316; shared since RA-495).
 *
 * Owns the "record the payment date and duly make the application" flow.
 * The application STAYS in `duly-made` afterwards — nothing in RA-316
 * moves it on, so there is no onward transition to anticipate here.
 *
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }
 *  - { ok: false, outcome, status?, errorCode?, message }
 *
 * `errorCode` is the one addition to the shape the other module services
 * use, and it is the whole reason this flow can render a proper GOV.UK
 * field error instead of a generic page. The backend answers a bad payment
 * date with 400 + ProblemDetails carrying `errorCode`; the controller binds
 * it to the date input when it is a `payment-date-*` code and falls back to
 * a page-level banner otherwise.
 *
 * Constructor takes the backend call so tests can stub it without mocking
 * `undici`. RA-495: by default it is the call the work item's type declares
 * (`standardLifecycle.backend.dulyMake`), else the type-less endpoint.
 */

import { toOutcome } from '../../backend-outcome.js'
import { lifecycleBackendCall } from '../lifecycle.js'

/**
 * @param {object} options
 * @param {string} [options.typeId] the type whose backend call to use
 * @param {Function} [options.dulyMake] the backend call, overriding the type's
 */
export function createDulyMakingService({
  typeId,
  dulyMake = (args) => lifecycleBackendCall(typeId, 'dulyMake')(args)
} = {}) {
  return {
    /**
     * Duly make a work item.
     *
     * @param {object} args
     * @param {string} args.workItemId
     * @param {string} args.paymentDate Plain `YYYY-MM-DD`. Never an ISO
     *   timestamp — the backend parses with an exact `yyyy-MM-dd` format
     *   and rejects anything carrying a time component.
     */
    async dulyMakeWorkItem({ workItemId, paymentDate, user = null }) {
      if (typeof workItemId !== 'string' || workItemId.trim() === '') {
        throw new Error('workItemId must be a non-empty string')
      }
      if (typeof paymentDate !== 'string' || paymentDate.trim() === '') {
        throw new Error('paymentDate must be a non-empty string')
      }

      const result = await dulyMake({ workItemId, paymentDate, user })

      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }

      return {
        ok: false,
        outcome: toOutcome(result.reason),
        status: result.status,
        errorCode: result.errorCode ?? null,
        message: result.message ?? 'Duly making failed'
      }
    }
  }
}
