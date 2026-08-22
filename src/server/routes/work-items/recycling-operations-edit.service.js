/**
 * Recycling operations edit service (RA-469 8pi).
 *
 * Owns the single backend call behind the edit form and translates the
 * client's `reason` vocabulary into controller-facing `outcome`s, so the
 * controller switches on intent rather than parsing HTTP status codes —
 * the same result-object pattern `query.service.js` uses for the query
 * form's single backend call.
 */

import { updateRecyclingOperations } from '#/server/common/helpers/backend-api/backend-api.js'

/**
 * `updateRecyclingOperations` reuses the shared `REASON_BY_STATUS` map
 * (400/401/403/404/409 -> invalid/unauthorized/forbidden/not-found/
 * conflict). `unauthorized` and `forbidden` both collapse to `forbidden`
 * here — AC14's nation-scoping denial and a plain unauthenticated-session
 * denial read the controller the same way (a 403 redirect with an error
 * banner, never a 500).
 */
const RECYCLING_OPERATIONS_OUTCOME = {
  invalid: 'invalid',
  unauthorized: 'forbidden',
  forbidden: 'forbidden',
  'not-found': 'not-found',
  conflict: 'conflict',
  network: 'network',
  server: 'server'
}

export function createRecyclingOperationsService({
  update = updateRecyclingOperations
} = {}) {
  return {
    /**
     * Send the updated codes to the backend.
     *
     * @returns {Promise<{ ok: true, workItem: object }
     *                 | { ok: false, outcome: string, message: string }>}
     */
    async updateCodes({ workItemId, siteId, operationCodes, user = null }) {
      const result = await update({ workItemId, siteId, operationCodes, user })

      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }

      return {
        ok: false,
        outcome: RECYCLING_OPERATIONS_OUTCOME[result.reason] ?? 'server',
        message:
          result.message ?? 'Could not update the recycling operation codes'
      }
    }
  }
}
