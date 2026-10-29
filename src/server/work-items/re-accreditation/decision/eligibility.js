/**
 * Single gate for the re-accreditation "Log decision" flow (RA-410).
 *
 * Used by BOTH the CTA visibility check (`work-items/detail.controller.js`)
 * and the decision routes' own guard (`./controller.js`), so the button and
 * the URL can never disagree — the discipline `approve-eligibility.js`
 * established for RA-346 and `duly-making/eligibility.js` for RA-316. This
 * file IS the former `approve-eligibility.js`, renamed and widened; there is
 * deliberately no parallel approve path left behind.
 *
 * ⚠ WHY THIS DOES NOT CALL `canApplyAction`.
 *
 * Same reason as `duly-making/eligibility.js`. Both decision transitions
 * (`make-determination-approved` / `make-determination-rejected`, RA-527)
 * are declared `callerInvocable: false` in `module.js` (v12) because neither
 * is reachable through the generic `/actions/{actionId}` route any more —
 * they are applied server-side by `POST /work-items/re-accreditation/{id}/decision`.
 * `core/engine.js#canApplyAction` refuses ANY transition declared that way,
 * returning `'not-caller-invocable'`, so routing this gate through it would
 * answer "never allowed" for every work item and the CTA would never render.
 *
 * The fix is NOT to drop the flag from the declaration — it is a truthful
 * mirror of the backend and it is what stops the generic action loop
 * rendering a bare decision button beside the Log decision CTA. Instead this
 * helper reads the SAME declared transitions and applies the state rules
 * only, so the state literals still live exactly once, in `module.js`.
 *
 * TWO entry states are allowed, and the second is not an accident:
 *
 *  - `assessment-in-progress` — the normal path. The backend applies
 *    `submit-for-decision` and then the decision in one atomic write.
 *  - `awaiting-decision` — the rescue path. Items already parked there when
 *    RA-410 shipped (and any left there by a mid-hop backend failure) would
 *    otherwise strand, because nothing in the new UI offers a button from
 *    that state. management-be's `/decision` accepts it as an entry state
 *    precisely so a retry completes rather than needing a rescue tool;
 *    confirmed with the backend owner.
 *
 * RA-595 adds a THIRD, frontend-only entry state:
 *
 *  - `duly-made` — the state the `startsOnSelfAssign` transition
 *    (`start-assessment`) leaves from. management-be
 *    lists no decision actions there and still refuses `/decision` from it,
 *    so this is a deliberate frontend rule, not a mirror of the backend: the
 *    submit route runs `core/ensure-assessment-started.js` first (assign if
 *    unassigned, then `start-assessment`), which moves the case into
 *    `assessment-in-progress` before the decision is posted. Found by the
 *    same `startsOnSelfAssign` marker that step uses, so the CTA and the
 *    submit cannot disagree, and the `duly-made` literal stays in
 *    `module.js`.
 *
 * RA-527 follow-up adds a FOURTH, mirroring management-be v18:
 *
 *  - `assessment-started` — where `start-assessment` now lands. A started
 *    case still reads "Duly made"; the backend takes `submit-for-decision`
 *    from it and then the decision. Read off the start transition's
 *    `toStateId`, so the literal stays in `module.js`.
 *
 * The backend remains authoritative: it applies its own server-side gate and
 * answers 409 to a forged POST regardless of what this says.
 */

import { getWorkItemType } from '../../core/registry.js'
import { resolveSelfAssignLandingState } from '../../core/engine.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

export const RE_ACCREDITATION_TYPE_ID = 're-accreditation'

/**
 * The two decision outcomes, keyed by the value the radio posts.
 *
 * `actionId` names the transition in `module.js` whose `toStateId` is the
 * state the outcome lands on (RA-527: step 1's non-terminal
 * `approved-pending-contact` / `rejected-pending-contact`), and whose `fromStateId` is the state
 * a decision is taken from. Nothing here hardcodes `approved` / `rejected` /
 * `awaiting-decision` — those are read off the declaration.
 *
 * ⚠ The KEYS are the wire values management-be accepts in the `outcome`
 * field (`"approved"` | `"rejected"`), NOT display labels. "Refused" is a
 * label change only: the wire value stays `rejected`, the state id stays
 * `rejected` and the notification
 * templates are unchanged. The visible word lives in the radio's label in
 * `routes/re-accreditation/decision/index.njk` and nowhere else.
 */
export const DECISION_OUTCOMES = Object.freeze({
  approved: 'make-determination-approved',
  rejected: 'make-determination-rejected'
})

// The transition whose `fromStateId` is the EARLIER of the two entry states.
// Read rather than hardcoded so `assessment-in-progress` stays a module.js
// literal.
const SUBMIT_FOR_DECISION_ACTION_ID = 'submit-for-decision'

const logger = createLogger()

/**
 * Is `outcome` one of the two values the decision endpoint accepts?
 *
 * @param {unknown} outcome
 * @returns {boolean}
 */
export function isValidDecisionOutcome(outcome) {
  return (
    typeof outcome === 'string' && Object.hasOwn(DECISION_OUTCOMES, outcome)
  )
}

/**
 * The states from which a decision may be logged, derived from the module
 * declaration so the literals live in one place.
 *
 * @param {object} type Work item type declaration.
 * @returns {Set<string>}
 */
function decisionEntryStates(type) {
  const transitions = type?.transitions ?? []
  const states = new Set()

  // `awaiting-decision` — the state both outcome transitions fire from.
  for (const actionId of Object.values(DECISION_OUTCOMES)) {
    const transition = transitions.find((t) => t.actionId === actionId)
    if (transition?.fromStateId != null) {
      states.add(transition.fromStateId)
    }
  }

  // `assessment-in-progress` — the state the backend's combined call enters
  // from, applying `submit-for-decision` itself before the decision.
  const submit = transitions.find(
    (t) => t.actionId === SUBMIT_FOR_DECISION_ACTION_ID
  )
  if (submit?.fromStateId != null) {
    states.add(submit.fromStateId)
  }

  // RA-595. `duly-made` — a frontend-only rule. The submit route starts
  // assessment before posting the decision, so the backend never sees a
  // decision from this state.
  const start = transitions.find((t) => t.startsOnSelfAssign === true)
  if (start?.fromStateId != null) {
    states.add(start.fromStateId)
  }

  // RA-527 follow-up. `assessment-started` — the state the start lands on, a
  // started case that still reads "Duly made". management-be v18 declares a
  // second `submit-for-decision` from it, which `module.js` cannot mirror
  // (action ids are unique there), so it is read off the start's `toStateId`
  // by `core/engine.js#resolveSelfAssignLandingState`, the same helper behind
  // the change-deadline link.
  const landingStateId = resolveSelfAssignLandingState(type)
  if (landingStateId != null) {
    states.add(landingStateId)
  }

  return states
}

/**
 * Can a decision be logged against this work item right now?
 *
 * @param {object} workItem A work item as returned by the backend — the RAW
 *   DTO, never a decorated view model. (`duly-making/eligibility.js` carries
 *   the full account of why that distinction has teeth: a view-model-only
 *   field silently refuses every item while unit tests pass against
 *   hand-built fixtures.)
 * @returns {{ allowed: boolean, reason?: string }} `reason` is one of
 *   `'wrong-type'`, `'type-not-registered'`, `'unknown-action'`,
 *   `'invalid-work-item'`, `'terminal-state'` or `'invalid-transition'`.
 */
export function evaluateLogDecisionEligibility(workItem) {
  // Reachable: the decision routes take an arbitrary `{id}` under the
  // `/work-items/re-accreditation/` prefix, but nothing guarantees the item
  // that comes back IS a re-accreditation. Deciding a different type through
  // this endpoint must be refused.
  if (
    workItem?.typeId != null &&
    workItem.typeId !== RE_ACCREDITATION_TYPE_ID
  ) {
    return { allowed: false, reason: 'wrong-type' }
  }

  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  if (!type) {
    // Wiring fault, not a user error. Fail CLOSED, but distinctly — reusing
    // `'unknown-action'` here would render the misleading "can no longer be
    // decided from its current state" banner, sending whoever hits it
    // looking at the work item instead of at the server wiring.
    logger.error(
      { typeId: RE_ACCREDITATION_TYPE_ID },
      'Re-accreditation type is not registered; refusing to log a decision'
    )
    return { allowed: false, reason: 'type-not-registered' }
  }

  const entryStates = decisionEntryStates(type)
  if (entryStates.size === 0) {
    // The declaration lost both decision transitions — a wiring fault of the
    // same class as an unregistered type, not a user error.
    logger.error(
      { typeId: RE_ACCREDITATION_TYPE_ID },
      'Re-accreditation declares no decision transitions; refusing to log a decision'
    )
    return { allowed: false, reason: 'unknown-action' }
  }

  const stateId = workItem?.stateId
  if (!stateId) {
    return { allowed: false, reason: 'invalid-work-item' }
  }

  // Checked BEFORE the entry-state test, not after, so an already-decided
  // item reports `terminal-state` rather than `invalid-transition`. The
  // banners differ and the distinction is the one a user needs: "this was
  // already decided" is not "this is at the wrong stage".
  const currentState = type.states?.find((s) => s.id === stateId)
  if (currentState?.isTerminal) {
    return { allowed: false, reason: 'terminal-state' }
  }

  if (!entryStates.has(stateId)) {
    return { allowed: false, reason: 'invalid-transition' }
  }

  return { allowed: true }
}

/**
 * The state id an outcome lands on (RA-527: step 1's `approved-pending-contact`
 * or `rejected-pending-contact`), read off the module
 * declaration.
 *
 * Used only for logging and for the success banner's wording, never as a
 * gate — the backend decides where the item actually ends up.
 *
 * @param {string} outcome `'approved'` | `'rejected'`
 * @returns {string|null}
 */
export function targetStateForOutcome(outcome) {
  if (!isValidDecisionOutcome(outcome)) {
    return null
  }
  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  const transition = (type?.transitions ?? []).find(
    (t) => t.actionId === DECISION_OUTCOMES[outcome]
  )
  return transition?.toStateId ?? null
}
