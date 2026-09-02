import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { RE_ACCREDITATION_TYPE_ID } from '#/server/work-items/re-accreditation/decision/eligibility.js'
import { DULY_MAKE_ACTION_ID } from '#/server/work-items/re-accreditation/duly-making/eligibility.js'

const CONTINUE_REVIEW_ACTION_PREFIX = 'continue-review-during-'

// RA-523. The transition that carries a query-answered, payment-awaiting
// item from `updated` straight to assessment. Referenced by id because it
// is the ONE transition out of `updated` that is not a continue-review —
// see `resolvePaymentReceivedAction` for why the id is unavoidable here.
const PAYMENT_RECEIVED_ACTION_ID = 'payment-received-during-duly-made'

// The transition whose `fromStateId` IS the origin that the action above
// serves. Deriving the origin from this declaration rather than writing
// `'duly-made'` keeps that literal in `module.js`, exactly as
// `isPreDulyMadeWaypoint` does for `'submitted'`.
const PAYMENT_RECEIVED_ORIGIN_SOURCE_ACTION_ID = 'payment-received'

/**
 * Is `stateId` the state the `continue-review-during-*` transitions leave
 * from? (RA-410.)
 *
 * Derived from the module declaration rather than comparing against a
 * `'updated'` literal, so that literal stays in `re-accreditation/module.js`
 * and a change to it moves this predicate — and therefore the CTA — with it.
 * All four `continue-review-during-*` entries share one `fromStateId`, which
 * is the whole reason they are non-caller-invocable, so any one of them
 * answers the question.
 *
 * Returns `false` when the type is not registered or declares no such
 * transition: failing CLOSED here hides a CTA rather than offering one the
 * route would refuse.
 */
export function isContinueReviewState(stateId) {
  if (stateId == null) {
    return false
  }
  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  return (type?.transitions ?? []).some(
    (t) =>
      t.actionId?.startsWith(CONTINUE_REVIEW_ACTION_PREFIX) &&
      t.fromStateId === stateId
  )
}

/**
 * Was this `updated` item queried BEFORE it was ever duly made? (RA-454.)
 *
 * `originStateId` is the state a waypoint item returns to when its query
 * discharges. When that origin is the state the `duly-make` transition
 * leaves from, the application has never been duly made — there is no review
 * to "continue", only a duly-making decision still to take. The Continue
 * review CTA must be suppressed in that case so the page offers Duly make
 * alone; running `continue-review-during-*` there would send the item back to
 * `submitted` ("Not started"), the confusing regression this ticket fixes.
 *
 * Derived from the module's own `duly-make` declaration rather than a
 * `'submitted'` literal, so that literal stays in `re-accreditation/module.js`
 * and a change to its `fromStateId` moves this predicate — and therefore the
 * CTA gate — with it. Fails CLOSED (returns `false`) when the type or its
 * `duly-make` transition is not registered, matching `isContinueReviewState`:
 * an unknown wire shape leaves Continue review visible rather than silently
 * hiding it.
 */
export function isPreDulyMadeWaypoint(originStateId) {
  if (originStateId == null) {
    return false
  }
  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  const dulyMake = (type?.transitions ?? []).find(
    (t) => t.actionId === DULY_MAKE_ACTION_ID
  )
  return dulyMake != null && dulyMake.fromStateId === originStateId
}

/**
 * Was this `updated` item queried while it was waiting for payment?
 * (RA-523.)
 *
 * `originStateId` is the state a waypoint item returns to when its query
 * discharges. When that origin is the state the `payment-received`
 * transition leaves from — `duly-made` — the application was queried
 * INSTEAD of having its payment recorded. Tom's ruling is that the
 * operator's response carries the payment, so such an item goes straight
 * to assessment rather than back to `duly-made` for a second click.
 *
 * This is the discriminator that REPLACES Continue review on that one
 * screen. Every other origin is untouched: `submitted` still gets Duly
 * make (RA-454), `assessment-in-progress` and `awaiting-decision` still
 * get Continue review, and a null origin still gets nothing.
 *
 * Derived from the module's own `payment-received` declaration rather than
 * a `'duly-made'` literal — same discipline as `isPreDulyMadeWaypoint`, so
 * that literal lives in `re-accreditation/module.js` and a change to it
 * moves this predicate and therefore the CTA. Fails CLOSED (`false`) when
 * the type or the transition is not registered: an unknown wire shape
 * leaves Continue review in place rather than silently swapping in a
 * control the route may refuse.
 */
export function isPaymentAwaitingWaypoint(originStateId) {
  if (originStateId == null) {
    return false
  }
  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  const paymentReceived = (type?.transitions ?? []).find(
    (t) => t.actionId === PAYMENT_RECEIVED_ORIGIN_SOURCE_ACTION_ID
  )
  return (
    paymentReceived != null && paymentReceived.fromStateId === originStateId
  )
}

/**
 * The `updated` -> assessment transition, projected to what the CTA needs
 * (RA-523), or `null` when it is not registered.
 *
 * The LABEL comes from the declaration, never from a literal in a template
 * or controller: management-be deliberately gives this transition a
 * different DisplayName from the `duly-made` `payment-received` hop,
 * because on the `updated` waypoint no payment event has occurred — the
 * operator answered a query. Reading it from here means the wording is
 * changed in one place and the button, the mirror and the tests all move
 * together.
 *
 * Looked up by `actionId`, unavoidably: unlike the origin above there is
 * no other declaration to derive it from, and matching on `fromStateId`
 * alone would also match the four `continue-review-during-*` transitions
 * that share `updated`.
 */
export function resolvePaymentReceivedAction() {
  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  const transition = (type?.transitions ?? []).find(
    (t) => t.actionId === PAYMENT_RECEIVED_ACTION_ID
  )
  if (transition == null) {
    return null
  }
  return {
    actionId: transition.actionId,
    displayName: transition.displayName ?? transition.actionId
  }
}
