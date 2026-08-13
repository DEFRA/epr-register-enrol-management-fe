/**
 * Re-accreditation decision service (RA-410).
 *
 * Owns the "log the outcome" flow that replaced RA-132's approve
 * interstitial. One method, one backend call, both outcomes.
 *
 * ⚠ ONE CALL, NOT TWO. The underlying lifecycle is two hops
 * (`assessment-in-progress` -> `awaiting-decision` -> `approved`/`rejected`)
 * but management-be applies both inside `POST /work-items/re-accreditation/{id}/decision`
 * as a single atomic write. Do not reintroduce a `submit-for-decision` call
 * here: a failure between the two would leave a terminal decision unrecorded
 * with the item parked in a state the UI no longer offers a button for.
 * Neither hop is caller-invocable any more in any case (see `module.js`).
 *
 * The approve path still runs through the backend's
 * `ReAccreditationApprovalService`, so accreditation-id generation, the
 * start date, the SLA-clock stop, the publishing audit entry and the
 * decision notification all still happen exactly as they did under RA-132.
 * Nothing about approval was reimplemented here — only the route in.
 *
 * Result shape — controllers branch on `outcome` rather than parsing HTTP
 * status codes:
 *  - { ok: true, workItem }
 *  - { ok: false, outcome, status?, errorCode?, message }
 *
 * ⚠ Two different things are called "outcome" in this file and they are not
 * the same. The `outcome` ARGUMENT is the decision the case worker made
 * (`'approved'` | `'rejected'`). The `outcome` FIELD on a failure result is
 * the framework's error classification (`'conflict'`, `'invalid'`, …), the
 * same vocabulary every other module service returns. Renaming either would
 * break a convention; they simply collide.
 *
 * `errorCode` mirrors the `/duly-make` vocabulary so the controller can bind
 * a 400 straight to the radio group instead of a page-level banner.
 *
 * Constructor takes a lazy backend-client getter so tests can stub the call
 * without mocking `undici`.
 */

import { toOutcome } from '../../core/backend-outcome.js'
import { isValidDecisionOutcome } from './eligibility.js'

const NOTE_MAX_LENGTH = 2000

export const DECISION_NOTE_MAX_LENGTH = NOTE_MAX_LENGTH

async function defaultRecordDecision(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.recordReAccreditationDecision(args)
}

async function defaultAddNote(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.addWorkItemNote(args)
}

export function createDecisionService({
  recordDecision = defaultRecordDecision,
  addNote = defaultAddNote
} = {}) {
  return {
    /**
     * Record a decision against a re-accreditation work item.
     *
     * @param {object} args
     * @param {string} args.workItemId
     * @param {string} args.outcome `'approved'` or `'rejected'`. The WIRE
     *   value — never the display label. "Refused" is what the radio says;
     *   `rejected` is what goes over the wire and what the backend's
     *   unchanged `reject` transition and notification templates key on.
     * @param {string} [args.decisionNote] Optional rationale. Posted to the
     *   notes endpoint BEFORE the decision — see below.
     */
    async recordWorkItemDecision({
      workItemId,
      outcome,
      decisionNote = '',
      user = null
    }) {
      if (typeof workItemId !== 'string' || workItemId.trim() === '') {
        throw new Error('workItemId must be a non-empty string')
      }

      // Validated here as well as in the controller because this is a public
      // service method: a future caller that skips the form must not be able
      // to post an arbitrary string to the backend. Returns a result rather
      // than throwing, so the controller renders a field error either way.
      if (!isValidDecisionOutcome(outcome)) {
        return {
          ok: false,
          outcome: 'invalid',
          errorCode: 'invalid-outcome',
          message: 'Select the decision for this application.'
        }
      }

      const trimmedNote =
        typeof decisionNote === 'string' ? decisionNote.trim() : ''

      if (trimmedNote.length > NOTE_MAX_LENGTH) {
        return {
          ok: false,
          outcome: 'invalid',
          errorCode: 'decision-note-too-long',
          message: `Decision note must be ${NOTE_MAX_LENGTH} characters or fewer.`
        }
      }

      // RA-203. The note is posted FIRST, and the ordering is the whole
      // mechanism — not incidental sequencing.
      //
      // management-be's Decision notification reads `decision_notes` from
      // `LatestWorkItemNoteText`, i.e. the most recent work-item note by
      // `CreatedAt`. Posting after the decision would race the notification
      // hook, which fires during the decision write, and the operator's email
      // would carry the PREVIOUS note (or nothing) instead of this rationale.
      //
      // RA-410 note: this is the same ordering the RA-132 approval service
      // used. It was momentarily lost when the approve interstitial was
      // retired, which left `decision_notes` resolving to empty on every
      // decision — the placeholder still rendered, so nothing failed loudly.
      // Do not "simplify" by folding the note into the `/decision` payload:
      // that endpoint has no note field, and adding one would duplicate a
      // notes API that already exists and already audits.
      if (trimmedNote !== '') {
        const noteResult = await addNote({
          workItemId,
          text: trimmedNote,
          user
        })
        if (!noteResult.ok) {
          // Deliberately do NOT proceed to the decision. The note is part of
          // the auditable rationale for a regulatory decision; recording the
          // outcome without it would produce a decision whose stated reason
          // silently went missing, and the decision cannot be un-made.
          return {
            ok: false,
            outcome: 'note-failed',
            status: noteResult.status,
            errorCode: null,
            message:
              noteResult.problem?.detail ??
              noteResult.error ??
              'Could not save the decision note. The decision was not recorded.'
          }
        }
      }

      const result = await recordDecision({ workItemId, outcome, user })

      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }

      return {
        ok: false,
        outcome: toOutcome(result.reason),
        status: result.status,
        errorCode: result.errorCode ?? null,
        message: result.message ?? 'Recording the decision failed'
      }
    }
  }
}
