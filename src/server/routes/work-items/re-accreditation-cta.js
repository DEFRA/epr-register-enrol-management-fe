import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { RE_ACCREDITATION_TYPE_ID } from '#/server/work-items/re-accreditation/decision/eligibility.js'
import { DULY_MAKE_ACTION_ID } from '#/server/work-items/re-accreditation/duly-making/eligibility.js'

const CONTINUE_REVIEW_ACTION_PREFIX = 'continue-review-during-'

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
