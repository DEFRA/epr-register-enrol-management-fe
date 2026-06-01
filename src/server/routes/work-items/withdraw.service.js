/**
 * Withdraw confirmation service (RA-188).
 *
 * Drives the two-step "post optional note → apply withdraw transition"
 * flow used by the withdraw confirmation interstitial. Mirrors the
 * approve-determination service so controllers branch on `outcome`
 * rather than parsing HTTP status codes.
 */

import { createWorkItemActionsService } from '#/server/work-items/core/service.js'

export const WITHDRAW_NOTE_MAX_LENGTH = 500

const WITHDRAW_ACTION_PREFIX = 'withdraw'

export function isWithdrawActionId(actionId) {
  if (typeof actionId !== 'string') return false
  return (
    actionId === WITHDRAW_ACTION_PREFIX ||
    actionId.startsWith(`${WITHDRAW_ACTION_PREFIX}-`)
  )
}

const ACTION_OUTCOME = {
  invalid: 'invalid',
  'not-authorized': 'forbidden',
  'not-allowed': 'conflict',
  'not-found': 'not-found',
  network: 'network',
  transport: 'network'
}

export function createWithdrawService({
  workItemActions = createWorkItemActionsService()
} = {}) {
  return {
    /**
     * Withdraw a work item, optionally posting a note first so the audit
     * log captures the caseworker's rationale before the state changes.
     */
    async withdrawWorkItem({ workItemId, actionId, note = '', user = null }) {
      if (!isWithdrawActionId(actionId)) {
        return {
          ok: false,
          outcome: 'invalid',
          message: 'Unsupported withdraw action.'
        }
      }

      const trimmedNote = typeof note === 'string' ? note.trim() : ''

      if (trimmedNote.length > WITHDRAW_NOTE_MAX_LENGTH) {
        return {
          ok: false,
          outcome: 'invalid',
          message: `Note must be ${WITHDRAW_NOTE_MAX_LENGTH} characters or fewer.`
        }
      }

      if (trimmedNote !== '') {
        const noteResult = await workItemActions.addNote({
          workItemId,
          text: trimmedNote,
          user
        })
        if (!noteResult.ok) {
          return {
            ok: false,
            outcome: 'note-failed',
            message:
              noteResult.message ??
              'Could not save the withdrawal note. The withdrawal was not submitted.'
          }
        }
      }

      const actionResult = await workItemActions.applyAction({
        workItemId,
        actionId,
        user
      })

      if (actionResult.ok) {
        return { ok: true, workItem: actionResult.workItem }
      }

      return {
        ok: false,
        outcome: ACTION_OUTCOME[actionResult.reason] ?? 'server',
        message: actionResult.message ?? 'Withdrawal failed'
      }
    }
  }
}
