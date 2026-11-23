/**
 * Single gate for the Standard-lifecycle "Log decision" flow (RA-410; shared
 * by every type that opts into the Standard lifecycle since RA-495, each
 * gate scoped to the type whose page or CTA asks).
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
 * are declared `callerInvocable: false` in `core/standard-workflow.js` (v12) because neither
 * is reachable through the generic `/actions/{actionId}` route any more —
 * they are applied server-side by `POST /work-items/{id}/decision` (or
 * re-accreditation's `POST /work-items/re-accreditation/{id}/decision`).
 * `core/engine.js#canApplyAction` refuses ANY transition declared that way,
 * returning `'not-caller-invocable'`, so routing this gate through it would
 * answer "never allowed" for every work item and the CTA would never render.
 *
 * The fix is NOT to drop the flag from the declaration — it is a truthful
 * mirror of the backend and it is what stops the generic action loop
 * rendering a bare decision button beside the Log decision CTA. Instead this
 * helper reads the SAME declared transitions and applies the state rules
 * only, so the state literals still live exactly once, in `core/standard-workflow.js`.
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
 *    `core/standard-workflow.js`.
 *
 * RA-527 follow-up adds a FOURTH, mirroring management-be v18:
 *
 *  - `assessment-started` — where `start-assessment` now lands. A started
 *    case still reads "Duly made"; the backend takes `submit-for-decision`
 *    from it and then the decision. Read off the start transition's
 *    `toStateId`, so the literal stays in `core/standard-workflow.js`.
 *
 * The backend remains authoritative: it applies its own server-side gate and
 * answers 409 to a forged POST regardless of what this says.
 */

import { getWorkItemType } from '../../registry.js'
import { resolveActionEntryStates } from '../../engine.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import { resolveScopedType } from '../lifecycle.js'

/**
 * The two decision outcomes, keyed by the value the radio posts.
 *
 * `actionId` names the transition in `core/standard-workflow.js` whose `toStateId` is the
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
 * `routes/standard-lifecycle/decision/index.njk` and nowhere else.
 */
export const DECISION_OUTCOMES = Object.freeze({
  approved: 'make-determination-approved',
  rejected: 'make-determination-rejected'
})

// The transition whose `fromStateId` is the EARLIER of the two entry states.
// Read rather than hardcoded so `assessment-in-progress` stays a standard-workflow.js
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
  // `awaiting-decision` — the state both outcome transitions fire from.
  // `assessment-in-progress` — the state the backend's combined call enters
  // from, applying `submit-for-decision` itself before the decision.
  // RA-527 follow-up. `assessment-started` — the state the start lands on, a
  // started case that still reads "Duly made". management-be v18 declares a
  // second `submit-for-decision` from it, which `core/standard-workflow.js` cannot mirror
  // (action ids are unique there), so `core/engine.js#
  // resolveActionEntryStates` adds it off the start's `toStateId`, the same
  // helper behind the Query link (`isQueryState`).
  const states = resolveActionEntryStates(type, isDecisionEntryActionId)

  // RA-595. `duly-made` — a frontend-only rule. The submit route starts
  // assessment before posting the decision, so the backend never sees a
  // decision from this state.
  const start = (type?.transitions ?? []).find(
    (t) => t.startsOnSelfAssign === true
  )
  if (start?.fromStateId != null) {
    states.add(start.fromStateId)
  }

  return states
}

const DECISION_ENTRY_ACTION_IDS = new Set([
  ...Object.values(DECISION_OUTCOMES),
  SUBMIT_FOR_DECISION_ACTION_ID
])

function isDecisionEntryActionId(actionId) {
  return DECISION_ENTRY_ACTION_IDS.has(actionId)
}

/**
 * Can a decision be logged against this work item right now?
 *
 * @param {object} workItem A work item as returned by the backend — the RAW
 *   DTO, never a decorated view model. (`duly-making/eligibility.js` carries
 *   the full account of why that distinction has teeth: a view-model-only
 *   field silently refuses every item while unit tests pass against
 *   hand-built fixtures.)
 * @param {{ typeId: string }} scope The type whose page or CTA is asking. Its
 *   declaration supplies the states and the decision transitions.
 * @returns {{ allowed: boolean, reason?: string }} `reason` is one of
 *   `'wrong-type'`, `'type-not-registered'`, `'unknown-action'`,
 *   `'invalid-work-item'`, `'terminal-state'` or `'invalid-transition'`.
 */
export function evaluateLogDecisionEligibility(workItem, { typeId }) {
  // Reachable: the decision routes take an arbitrary `{id}` under the
  // type's prefix, but nothing guarantees the item that comes back IS of that
  // type. An unregistered type is a wiring fault: reusing `'unknown-action'`
  // would render the misleading "can no longer be decided from its current
  // state" banner, so it is refused distinctly.
  const scoped = resolveScopedType(
    workItem,
    typeId,
    logger,
    'logging a decision'
  )
  if (!scoped.type) {
    return { allowed: false, reason: scoped.reason }
  }
  const type = scoped.type

  const entryStates = decisionEntryStates(type)
  if (entryStates.size === 0) {
    // The declaration lost both decision transitions — a wiring fault of the
    // same class as an unregistered type, not a user error.
    logger.error(
      { typeId },
      'Work item type declares no decision transitions; refusing to log a decision'
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
 * @param {{ typeId: string }} scope the type whose declaration to read
 * @returns {string|null}
 */
export function targetStateForOutcome(outcome, { typeId }) {
  if (!isValidDecisionOutcome(outcome)) {
    return null
  }
  const type = getWorkItemType(typeId)
  const transition = (type?.transitions ?? []).find(
    (t) => t.actionId === DECISION_OUTCOMES[outcome]
  )
  return transition?.toStateId ?? null
}
