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
 *  - { ok: false, outcome: 'conflict' | 'forbidden' | 'not-found' |
 *      'invalid' | 'server' | 'network' | 'unauthorized',
 *      status?, message }                            on approval failure
 *
 * Constructor takes lazy backend-client getters so the tests can stub
 * one call without mocking `undici`. The defaults route through
 * `backend-api.js`'s typed clients.
 */

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
        outcome: APPROVE_OUTCOME[approveResult.reason] ?? 'server',
        status: approveResult.status,
        message: approveResult.message ?? 'Approval failed'
      }
    }
  }
}

export const APPROVAL_DECISION_NOTE_MAX_LENGTH = NOTE_MAX_LENGTH

const APPROVE_OUTCOME = {
  invalid: 'invalid',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  'not-found': 'not-found',
  conflict: 'conflict',
  server: 'server',
  network: 'network'
}
