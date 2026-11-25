/**
 * Standard-lifecycle change-valid-from service (RA-800).
 *
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }
 *  - { ok: false, outcome, status?, errorCode?, message }
 *
 * `errorCode` lets the controller bind a backend 400 to the date input or the
 * reason.
 *
 * Constructor takes a lazy backend-client getter so tests can stub the call
 * without mocking `undici`.
 */

import { toOutcome } from '../../backend-outcome.js'
import { lifecycleBackendCall } from '../lifecycle.js'

/**
 * @param {object} options
 * @param {string} [options.typeId] the type whose backend call to use
 *   (`standardLifecycle.backend.changeValidFrom`, else the type-less endpoint)
 * @param {Function} [options.changeValidFrom] overrides the type's call
 */
export function createChangeValidFromService({
  typeId,
  changeValidFrom = (args) =>
    lifecycleBackendCall(typeId, 'changeValidFrom')(args)
} = {}) {
  return {
    /**
     * @param {object} args
     * @param {string} args.workItemId
     * @param {string} args.effectiveDate Plain `YYYY-MM-DD`.
     * @param {string} args.reason
     */
    async changeValidFromForWorkItem({
      workItemId,
      effectiveDate,
      reason,
      user = null
    }) {
      if (typeof workItemId !== 'string' || workItemId.trim() === '') {
        throw new Error('workItemId must be a non-empty string')
      }
      if (typeof effectiveDate !== 'string' || effectiveDate.trim() === '') {
        throw new Error('effectiveDate must be a non-empty string')
      }
      if (typeof reason !== 'string' || reason.trim() === '') {
        throw new Error('reason must be a non-empty string')
      }

      const result = await changeValidFrom({
        workItemId,
        effectiveDate,
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
        message: result.message ?? 'Changing the valid from date failed'
      }
    }
  }
}
