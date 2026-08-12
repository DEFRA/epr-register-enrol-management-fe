/**
 * Re-accreditation duly-making service (RA-316).
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
 * Constructor takes a lazy backend-client getter so tests can stub the
 * call without mocking `undici`.
 */

import { toOutcome } from '../../core/backend-outcome.js'

async function defaultDulyMake(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.dulyMakeReAccreditation(args)
}

export function createDulyMakingService({ dulyMake = defaultDulyMake } = {}) {
  return {
    /**
     * Duly make a re-accreditation work item.
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
