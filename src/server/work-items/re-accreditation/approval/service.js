/**
 * Re-accreditation approval service (RA-132).
 *
 * Owns the two-step "approve determination" flow:
 *   1. If the case worker entered an optional decision note, post it to
 *      the existing notes endpoint so the audit log captures it before
 *      the state transition.
 *   2. Call the type-specific approve endpoint, which transitions the
 *      work item from `assessment-in-progress` to `approved` and stamps
 *      the issued `accreditationId` + `accreditationStartDate` onto the
 *      payload.
 *
 * Result shape — controllers branch on `outcome` rather than parsing
 * HTTP status codes:
 *  - { ok: true, workItem }                          on full success
 *  - { ok: false, outcome: 'note-failed', message }  when the optional
 *      note POST failed; the approval is NOT attempted because the
 *      note is part of the auditable rationale.
 *  - { ok: false, outcome: 'tasks-incomplete', status: 409, message }
 *      RA-346: the backend's server-side gate refused because an
 *      `awaiting-decision` task is still pending. Distinguished from a
 *      plain `conflict` by the ProblemDetails detail — see
 *      `approveOutcomeFor` at the bottom of this file.
 *  - { ok: false, outcome: 'conflict' | 'forbidden' | 'not-found' |
 *      'invalid' | 'server' | 'network' | 'unauthorized',
 *      status?, message }                            on approval failure
 *
 * Constructor takes lazy backend-client getters so the tests can stub
 * one call without mocking `undici`. The defaults route through
 * `backend-api.js`'s typed clients.
 */

import { toOutcome } from '../../core/backend-outcome.js'

const NOTE_MAX_LENGTH = 2000

async function defaultApprove(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.approveReAccreditation(args)
}

async function defaultAddNote(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.addWorkItemNote(args)
}

export function createApprovalService({
  approve = defaultApprove,
  addNote = defaultAddNote
} = {}) {
  return {
    /**
     * Approve a re-accreditation work item, optionally posting a
     * decision note first.
     */
    async approveWorkItem({ workItemId, decisionNote = '', user = null }) {
      if (typeof workItemId !== 'string' || workItemId.trim() === '') {
        throw new Error('workItemId must be a non-empty string')
      }

      const trimmedNote =
        typeof decisionNote === 'string' ? decisionNote.trim() : ''

      if (trimmedNote.length > NOTE_MAX_LENGTH) {
        return {
          ok: false,
          outcome: 'invalid',
          message: `Decision note must be ${NOTE_MAX_LENGTH} characters or fewer.`
        }
      }

      if (trimmedNote !== '') {
        const noteResult = await addNote({
          workItemId,
          text: trimmedNote,
          user
        })
        if (!noteResult.ok) {
          return {
            ok: false,
            outcome: 'note-failed',
            status: noteResult.status,
            message:
              noteResult.problem?.detail ??
              noteResult.error ??
              'Could not save the decision note. The approval was not submitted.'
          }
        }
      }

      const approveResult = await approve({ workItemId, user })
      if (approveResult.ok) {
        return { ok: true, workItem: approveResult.workItem }
      }

      return {
        ok: false,
        outcome: approveOutcomeFor(approveResult),
        status: approveResult.status,
        message: approveResult.message ?? 'Approval failed'
      }
    }
  }
}

export const APPROVAL_DECISION_NOTE_MAX_LENGTH = NOTE_MAX_LENGTH
/**
 * RA-346. The backend refuses an approve while any `awaiting-decision` task
 * is pending. Contract confirmed with the backend owner:
 *
 *   HTTP 409, ProblemDetails
 *     title:  "Could not approve re-accreditation"
 *     detail: "Action 'approve' requires every task for state
 *              'awaiting-decision' to be complete first."
 *
 * There is deliberately NO machine-readable discriminator: the service has
 * no `errorCode` / extension-member convention, and introducing one on this
 * endpoint alone would be a new inconsistent contract (a repo-wide
 * `failureCode` is a separate follow-up, not RA-346). The discriminator is
 * therefore (409 + detail), which is safe here because the backend now
 * generates this message from ONE place — `WorkItemEngineRules
 * .RequireAllTasksComplete` — so it is byte-identical whichever path
 * produced it, varying only in the interpolated action and state ids. The
 * frontend already string-matches this same shape in `core/service.test.js`.
 *
 * Matching on 409 alone would be WRONG: the other 409 on this endpoint is
 * the optimistic-concurrency conflict ("was modified concurrently"), which
 * needs the existing "refresh and try again" copy, not "complete your
 * tasks". Hence the substring test rather than a bare status check.
 *
 * RA-372 merge note: the base outcome now comes from the shared
 * `core/backend-outcome.js` allow-list rather than a map duplicated per
 * service. `tasks-incomplete` is layered ON TOP of that — it is not a
 * backend `reason`, it is this endpoint reading a 409's detail more
 * closely, so it stays local to the approval service.
 */
const TASKS_INCOMPLETE_DETAIL = /requires every task/i

function approveOutcomeFor(approveResult) {
  const outcome = toOutcome(approveResult.reason)
  if (
    outcome === 'conflict' &&
    TASKS_INCOMPLETE_DETAIL.test(approveResult.message ?? '')
  ) {
    return 'tasks-incomplete'
  }
  return outcome
}
