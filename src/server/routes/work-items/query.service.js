/**
 * Query-an-application service (RA-291).
 *
 * Owns the single backend call behind the query form and translates the
 * client's `reason` vocabulary into controller-facing `outcome`s, so the
 * controller switches on intent rather than parsing HTTP status codes.
 * Mirrors `withdraw.service.js`.
 *
 * The backend resolves the state transition itself — we never send an
 * action id — and it is authoritative for both authorisation and whether
 * the application is in a queryable state.
 */

import { raiseWorkItemQuery } from '#/server/common/helpers/backend-api/backend-api.js'

const QUERY_OUTCOME = {
  invalid: 'invalid',
  unauthorized: 'forbidden',
  'not-authorized': 'forbidden',
  'not-allowed': 'conflict',
  'not-found': 'not-found',
  network: 'network',
  transport: 'network'
}

export function createQueryService({ raiseQuery = raiseWorkItemQuery } = {}) {
  return {
    /**
     * Send the query to the backend.
     *
     * @returns {Promise<{ ok: true, workItem: object }
     *                 | { ok: false, outcome: string, message: string }>}
     */
    async raiseQuery({ workItemId, sections, reason, user = null }) {
      const result = await raiseQuery({ workItemId, sections, reason, user })

      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }

      return {
        ok: false,
        outcome: QUERY_OUTCOME[result.reason] ?? 'server',
        message: result.message ?? 'Could not send the query'
      }
    }
  }
}
