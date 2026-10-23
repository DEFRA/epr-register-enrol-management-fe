import { PENDING_CONTACT_STATE_IDS } from '#/server/work-items/re-accreditation/states.js'

// The states in which a case is closed. Drives BOTH the re-accreditation
// read-only Outcome panel (`isReadOnlyState`) and, since RA-358, the
// assignment gate in `buildAssignmentViewModel` — deliberately ONE list, so
// the two cannot disagree about what "closed" means.
//
// Still a hardcoded literal rather than a registry lookup: every registered
// type's terminal states should ultimately derive from the module's declared
// `states[].isTerminal` flag, which is tracked separately as epr-uf42. Reuse
// this constant rather than adding another list.
//
// RA-346 note for anyone tempted to add a terminal-state check to the
// decision gate in detail.controller.js: there is deliberately none.
// `canLogDecision` is answered by `evaluateLogDecisionEligibility`, which
// checks the type's own `isTerminal` flag before anything else, so a closed
// case fails it without consulting this list. The two rules are independent
// and both must hold.
export const TERMINAL_STATE_IDS = new Set(['approved', 'rejected', 'withdrawn'])

/**
 * Compute everything the detail template needs to render the assignment
 * panel:
 * - The current assignee (or null).
 * - The list of users available in the assign-to-anyone picker.
 * - Whether the caller can self-assign right now — RA-153's one-click
 *   shortcut, relabelled by RA-295 to the prototype's "Assign to yourself
 *   and start".
 *
 * RA-295 AC03: assignment must be available all the way through, so the
 * self-assign button is offered whenever the caller is not ALREADY the
 * assignee (claiming an unassigned item, or taking one over from a
 * colleague) rather than only while the item is unassigned. RA-323: every
 * caseworker has the same permissions, so the reassign / unassign links are
 * always available; the backend remains the source of truth and rejects
 * anything the caller may not do.
 *
 * RA-358 NARROWS BOTH OF THE ABOVE. "All the way through" now means through
 * the ACTIVE lifecycle: once a case reaches a terminal state (approved,
 * rejected, withdrawn) no assignment affordance renders at all.
 *
 * What was traded away, recorded deliberately so this does not read as an
 * oversight: RA-295 AC03's stated rationale was that a CLOSED case stays
 * reassignable SO IT CAN BE HANDED OVER, and there was a passing journey
 * test asserting exactly that (`ra-295-assignment-and-query.e2e.js`). Tom
 * overrode it as product authority after finding that "Assign to yourself
 * and start" on a withdrawn case worked — the label is nonsense on a closed
 * case, and before management-be's terminal-state guard the click really did
 * assign it. The hand-over use case was put to him explicitly and he chose
 * the gate; if it is ever reinstated, this is the flag to remove.
 *
 * This is a UI gate, not the enforcement point: management-be now rejects
 * assign/unassign on a terminal item with 409 TerminalState, so a forged
 * POST is still refused. The gate exists so the UI stops OFFERING an action
 * that can only fail — previously the page showed the withdrawn notice
 * ("no further action is needed") directly above three controls that
 * contradicted it.
 */
// RA-523. WHO holds the work item, normalised for display — split out from
// the affordance gates below because they are two different questions and
// were only ever adjacent, not related. This half restates facts the backend
// already decided; `buildAssignmentViewModel` decides what the CALLER may do
// about them. Keeping them in one function meant a change to either had to
// be read against the other.
//
// Every field is normalised to `null` rather than left `undefined` so the
// template's `{% if %}` checks and the mgmt-tests assertions see one absent
// value, not two.
function buildAssignmentIdentity(workItem) {
  return {
    assignedToId: workItem.assignedToId ?? null,
    // Falls back to the raw id when the backend has no display name for the
    // assignee, so the panel names SOMEBODY rather than rendering blank.
    assignedToName: workItem.assignedToName ?? workItem.assignedToId ?? null,
    assignedAt: workItem.assignedAt ?? null,
    assignedBy: workItem.assignedBy ?? null
  }
}

export function buildAssignmentViewModel({ workItem, user }) {
  const callerIsAssignee = user?.id != null && workItem.assignedToId === user.id
  // Reuses the single TERMINAL_STATE_IDS list that also drives the
  // re-accreditation read-only Outcome panel, so the two cannot disagree.
  // Unlike that one this is NOT type-scoped: any registered type reaching
  // one of these states gets the gate, which is the desired behaviour.
  const isClosed = TERMINAL_STATE_IDS.has(workItem.stateId)
  // We know who the caller is, and the case is still open.
  const canActOnAssignment = user?.id != null && !isClosed

  return {
    ...buildAssignmentIdentity(workItem),
    callerIsAssignee,
    // RA-358. Drives the "This application is closed" line in place of the
    // affordances. Kept as its own flag rather than being folded into
    // `canSelfAssign` because the template needs to distinguish "no button
    // because you already hold it" from "no controls because it is closed".
    isClosed,
    // RA-523. Strictly "you do not already hold this". RA-595 removed the
    // separate start control a caller who held a Duly made case used to get;
    // a held Duly made case is worked through its own actions (see
    // core/ensure-assessment-started.js). Do not reinstate a "|| in a
    // startsOnSelfAssign state" clause here: it would offer to assign the
    // caller a case they already hold (the RA-523 defect).
    // RA-527: not while a determination awaits applicant contact either —
    // "Assign to yourself and start" means nothing there, and the design
    // offers only Reassign / Unassign.
    canSelfAssign:
      canActOnAssignment &&
      !callerIsAssignee &&
      !PENDING_CONTACT_STATE_IDS.has(workItem.stateId)
    // RA-295 removed `isUnassigned`, `canUnassign` and `assignableUsers`
    // from this model: the reassign / unassign links are unconditional
    // WITHIN the active lifecycle (AC03, as narrowed by RA-358 above) and
    // the assignee picker moved to the reassign interstitial, which builds
    // its own list from the directory.
  }
}
