import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { resolveSelfAssignLandingState } from '#/server/work-items/core/engine.js'
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
 * Is this the id of a query transition — `query` or `query-<something>`?
 * (RA-291.) Re-accreditation declares four, `query-during-*`.
 */
export function isQueryActionId(actionId) {
  if (typeof actionId !== 'string') {
    return false
  }
  return actionId === 'query' || actionId.startsWith('query-')
}

/**
 * Can an application in `stateId` be queried? (RA-000.)
 *
 * Gates the Query link on the detail page and the query page itself. The
 * `query-during-*` transitions are non-caller-invocable from management-be
 * v19, so the backend no longer projects them into `availableActions` and
 * this cannot read the projection. It reads the module declaration instead,
 * the same discipline as `isContinueReviewState`: the state literals stay in
 * `re-accreditation/module.js`.
 *
 * management-be also declares `query-during-assessment` from
 * `assessment-started`, which the module cannot redeclare (action ids are
 * unique there). That state is the one the `startsOnSelfAssign` transition
 * lands on, so it is added from `resolveSelfAssignLandingState` — the same
 * way `decision/eligibility.js` covers the backend's second
 * `submit-for-decision`.
 *
 * The landing-state coupling exists only because of that duplicate-id
 * rule. This predicate only decides what to draw:
 * `POST /work-items/re-accreditation/{id}/query` is the authority, and
 * answers 409 for a state it will not query.
 *
 * Returns `false` for a missing `stateId`; callers that read a backend
 * response log that themselves. THROWS when the re-accreditation type is
 * not registered or declares no query transition: that is a boot or
 * declaration defect, and answering "not queryable" would silently hide
 * the Query link on every case.
 */
export function isQueryState(stateId) {
  if (stateId == null) {
    return false
  }
  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  if (!type) {
    throw new Error(
      `isQueryState: work item type "${RE_ACCREDITATION_TYPE_ID}" is not registered`
    )
  }
  const fromStateIds = Array.isArray(type.transitions)
    ? type.transitions
        .filter((t) => isQueryActionId(t.actionId))
        .map((t) => t.fromStateId)
    : null
  if (!fromStateIds?.length) {
    throw new Error(
      `isQueryState: work item type "${RE_ACCREDITATION_TYPE_ID}" declares no query transition`
    )
  }
  return (
    fromStateIds.includes(stateId) ||
    stateId === resolveSelfAssignLandingState(type)
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
