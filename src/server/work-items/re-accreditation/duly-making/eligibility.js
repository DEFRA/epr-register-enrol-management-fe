/**
 * Single gate for the re-accreditation "Duly make" flow (RA-316).
 *
 * Used by BOTH the CTA visibility check (`work-items/detail.controller.js`)
 * and the duly-making routes' own guard (`./controller.js`), so the button
 * and the URL can never disagree — the same discipline
 * `approve-eligibility.js` established for RA-346.
 *
 * ⚠ WHY THIS DOES NOT CALL `canApplyAction`, unlike `approve-eligibility.js`.
 *
 * The backend registers `duly-make` with `CallerInvocable: false` (the same
 * shape as the `continue-review-during-*` transitions), because duly making
 * runs through its own endpoint — `POST /work-items/re-accreditation/{id}/duly-make`
 * — and takes a payment date the generic action route has nowhere to put.
 * `core/engine.js#canApplyAction` deliberately refuses ANY transition
 * declared that way, returning `'not-caller-invocable'`, so routing this
 * gate through it would answer "never allowed" for every work item and the
 * CTA would never render.
 *
 * The fix is NOT to drop `callerInvocable: false` from the declaration —
 * that flag is a truthful mirror of the backend and it is what keeps
 * `projectWorkItem` from offering `duly-make` as a generic action button
 * that would post to a route incapable of carrying the payment date.
 * Instead this helper reads the SAME declared transition and applies the
 * state rules only, so the `submitted` literal still lives exactly once —
 * in `module.js` — and a change to `fromStateId` there moves the CTA with
 * it rather than silently desynchronising.
 *
 * The backend remains authoritative: it applies its own server-side gate
 * and answers 409 to a forged POST regardless of what this says.
 */

import { getWorkItemType } from '../../core/registry.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

export const RE_ACCREDITATION_TYPE_ID = 're-accreditation'
export const DULY_MAKE_ACTION_ID = 'duly-make'

const logger = createLogger()

/**
 * Can this work item be duly made right now?
 *
 * @param {object} workItem A work item as returned by the backend — the RAW
 *   DTO, never a decorated view model.
 * @returns {{ allowed: boolean, reason?: string }} `reason` is one of
 *   `'wrong-type'`, `'type-not-registered'`, `'unknown-action'`,
 *   `'invalid-work-item'`, `'terminal-state'` or `'invalid-transition'`.
 */
export function evaluateDulyMakeEligibility(workItem) {
  // Reachable: the duly-making routes take an arbitrary `{id}` under the
  // `/work-items/re-accreditation/` prefix, but nothing guarantees the item
  // that comes back IS a re-accreditation.
  if (
    workItem?.typeId != null &&
    workItem.typeId !== RE_ACCREDITATION_TYPE_ID
  ) {
    return { allowed: false, reason: 'wrong-type' }
  }

  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  if (!type) {
    // Wiring fault, not a user error. Fail CLOSED, but distinctly — see the
    // equivalent branch in `approve-eligibility.js` for why reusing
    // `'unknown-action'` here would send a reader looking at the work item
    // instead of at the server wiring.
    logger.error(
      { typeId: RE_ACCREDITATION_TYPE_ID },
      'Re-accreditation type is not registered; refusing duly making'
    )
    return { allowed: false, reason: 'type-not-registered' }
  }

  const transition = (type.transitions ?? []).find(
    (t) => t.actionId === DULY_MAKE_ACTION_ID
  )
  if (!transition) {
    return { allowed: false, reason: 'unknown-action' }
  }

  const stateId = workItem?.stateId
  if (!stateId) {
    return { allowed: false, reason: 'invalid-work-item' }
  }

  const currentState = type.states?.find((s) => s.id === stateId)
  if (currentState?.isTerminal) {
    return { allowed: false, reason: 'terminal-state' }
  }

  if (transition.fromStateId === stateId) {
    return { allowed: true }
  }

  // RA-316. The SECOND entry point into duly making. An application
  // queried while it was being duly made, and then resubmitted by the
  // operator, sits in the `updated` waypoint rather than in `submitted`.
  // The backend's endpoint accepts it — it discharges the waypoint and
  // duly-makes in a single write — so without this branch such an
  // application would have NO route to `duly-made` at all and would
  // strand, which is the regression the task-driven flow's removal would
  // otherwise introduce.
  //
  // The discriminator is `taskStateId`: the id of the state whose
  // checklist the projected `tasks` belong to. For a waypoint item the
  // backend resolves it from the work item's own audit history using the
  // SAME helper its duly-make endpoint uses to decide whether to accept
  // the item, so this gate and the backend's acceptance rule are one rule
  // rather than two that can drift.
  //
  // Comparing against the transition's own `fromStateId` keeps the
  // `submitted` literal in `module.js`, and testing `isTaskWaypoint`
  // rather than `stateId === 'updated'` keeps the `updated` literal there
  // too — the same discipline `canContinueReview` follows.
  //
  // An item queried from assessment or decision reports a different
  // `taskStateId` and is correctly refused: offering Duly make there
  // would invite a caseworker to send an application backwards past
  // assessment.
  //
  // `taskStateId` is nullable — it is null for a pre-v8 snapshot whose
  // origin genuinely cannot be resolved. Null must NOT fall through to a
  // permissive default: the backend answers 409 for exactly those items,
  // so a CTA here would be a button that always fails. The strict
  // equality below rejects null by construction.
  if (
    workItem?.isTaskWaypoint === true &&
    workItem?.taskStateId === transition.fromStateId
  ) {
    return { allowed: true }
  }

  return { allowed: false, reason: 'invalid-transition' }
}
