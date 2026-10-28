/**
 * Re-accreditation change-payment-date service (RA-576).
 *
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }
 *  - { ok: false, outcome, status?, errorCode?, message }
 *
 * `errorCode` lets the controller bind a backend 400 to the date input or the
 * reason, exactly as the duly-making service does.
 *
 * Constructor takes a lazy backend-client getter so tests can stub the call
 * without mocking `undici`.
 */

import { toOutcome } from '../../core/backend-outcome.js'

async function defaultChangePaymentDate(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.changePaymentDateReAccreditation(args)
}

export function createChangePaymentDateService({
  changePaymentDate = defaultChangePaymentDate
} = {}) {
  return {
    /**
     * @param {object} args
     * @param {string} args.workItemId
     * @param {string} args.paymentDate Plain `YYYY-MM-DD`.
     * @param {string} args.reason
     */
    async changePaymentDateForWorkItem({
      workItemId,
      paymentDate,
      reason,
      user = null
    }) {
      if (typeof workItemId !== 'string' || workItemId.trim() === '') {
        throw new Error('workItemId must be a non-empty string')
      }
      if (typeof paymentDate !== 'string' || paymentDate.trim() === '') {
        throw new Error('paymentDate must be a non-empty string')
      }
      if (typeof reason !== 'string' || reason.trim() === '') {
        throw new Error('reason must be a non-empty string')
      }

      const result = await changePaymentDate({
        workItemId,
        paymentDate,
        reason,
        user
      })

      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }

      return {
        ok: false,
        outcome: toOutcome(result.reason),
        status: result.status,
        errorCode: result.errorCode ?? null,
        message: result.message ?? 'Changing the payment date failed'
      }
    }
  }
}
