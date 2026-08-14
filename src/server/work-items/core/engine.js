/**
 * Pure helpers that mirror the backend state engine.
 *
 * The authoritative engine lives in `Backend.Api/WorkItems/Core/WorkItemService.cs`;
 * this module exists so frontend route handlers and module service objects can
 * inspect the work item the backend returned (or a freshly-built type
 * declaration) without re-implementing the rules. The backend already attaches
 * `availableActions` to each `WorkItemResponse`, so most callers can read that
 * directly. The helpers below are useful when the caller has only the type
 * declaration to hand (for example to ask "would this type allow `approve`
 * from this state?").
 *
 * RA-410. The task half of this engine is gone. `allTasksComplete` and the
 * `requiresAllTasksComplete` filter that gated `canApplyAction` went with it:
 * management-be deleted the property from `WorkItemTransition` entirely, so
 * there is no longer anything on the wire for them to mirror. Progress is
 * driven by the explicit Duly make / Assign to yourself and start / Log
 * decision CTAs instead. Do not reintroduce a completion gate here.
 */

/**
 * Is this projected action one the caller is actually allowed to invoke?
 *
 * RA-364. The backend's `WorkItemTransition` carries a `CallerInvocable`
 * flag (serialised as `callerInvocable`) that gates the generic
 * `POST /work-items/{id}/actions/{actionId}` endpoint. It is set to `false`
 * for transitions a module resolves server-side from the work item's own
 * history — most importantly when SEVERAL transitions share one
 * `fromStateId` and so cannot be disambiguated by the caller. In
 * re-accreditation that is four `resume-during-*` transitions out of
 * `queried` (all displayed "Resume") and four `continue-review-during-*`
 * out of `updated` (all displayed "Continue review").
 *
 * Those entries used to appear in `availableActions`, so a UI that renders
 * one control per entry drew four identical buttons, every one of which the
 * backend rejected on click.
 *
 * management-be now filters them at source, so against a patched backend
 * this predicate never fires. It is kept deliberately as the second half of
 * a two-sided fix: the case it defends is a STALE backend — a frontend
 * deployed ahead of the backend — which is precisely the window in which the
 * bug was visible, and the one window the backend's own filter cannot cover.
 *
 * Filtering by this flag is deliberately NOT the same as de-duplicating by
 * `displayName`. Two distinct actions may legitimately share a label; the
 * flag is the authoritative signal for "the caller may not pick this one".
 *
 * Only an EXPLICIT `false` suppresses an action. A missing or `undefined`
 * flag means invocable, which keeps older backend payloads — and any
 * fixture that predates the flag — rendering exactly as they do today. That
 * default is safe because the backend serialises the property
 * unconditionally (no `DefaultIgnoreCondition`), so a genuine `false` is
 * always on the wire and never silently absent.
 *
 * @param {{ callerInvocable?: boolean }} action A projected action.
 * @returns {boolean}
 */
export function isCallerInvocable(action) {
  return action?.callerInvocable !== false
}

/**
 * Compute the currently-available actions for a work item.
 *
 * @param {object} type Work item type declaration (`module.type`).
 * @param {{ stateId: string }} workItem
 * @returns {{
 *   availableActions: Array<{ actionId: string, displayName: string, fromStateId: string, toStateId: string }>
 * }}
 */
export function projectWorkItem(type, workItem) {
  if (!type) {
    return { availableActions: [] }
  }
  const stateId = workItem?.stateId

  const currentState = type.states?.find((s) => s.id === stateId)
  if (currentState?.isTerminal) {
    return { availableActions: [] }
  }

  const availableActions = (type.transitions ?? [])
    .filter((t) => t.fromStateId === stateId)
    // RA-372. Mirrors the backend's `CallerInvocable` flag. A transition
    // declared `callerInvocable: false` is applied by the server on the
    // caller's behalf (from an auto-transition hook, or from a
    // type-specific endpoint that resolves WHICH of several same-from-state
    // transitions applies) and must never be offered as a caller-chosen
    // action. Omitting the flag means invocable, matching the backend
    // default. Without this filter the mirror would advertise all four
    // re-accreditation `continue-review-during-*` transitions out of
    // `updated` as if the user could pick a destination.
    .filter((t) => t.callerInvocable !== false)
    .map((t) => ({
      actionId: t.actionId,
      displayName: t.displayName,
      fromStateId: t.fromStateId,
      toStateId: t.toStateId
    }))

  return { availableActions }
}

/**
 * Resolve the transition (if any) that self-assigning a work item should
 * apply on the caller's behalf (RA-410).
 *
 * "Assign to yourself and start" is two operations, and the SECOND one is
 * type-specific: for a re-accreditation it is `payment-received`, moving a
 * `duly-made` item into assessment. Rather than teach the generic
 * self-assign handler about re-accreditation, a module marks the transition
 * declaratively with `startsOnSelfAssign: true` and this helper looks it up.
 * The generic layer stays type-agnostic and the state literal stays in the
 * module's declaration — the same discipline `callerInvocable` follows.
 *
 * ⚠ The `fromStateId` match is what makes this safe, and it is the whole
 * point. RA-295 renders the assignment panel in EVERY state, so self-assign
 * fires against `queried`, `awaiting-decision` and the rest. Only a work
 * item actually sitting in the marked transition's `fromStateId` gets a
 * state change; everywhere else this returns `null` and self-assign stays a
 * plain assignment. Loosening this to "the type declares one somewhere"
 * would silently transition items from unrelated states.
 *
 * Returns `null` for a terminal state, an unregistered type, or a type that
 * marks no such transition — self-assign then does nothing extra.
 *
 * @param {object} type Work item type declaration (`module.type`).
 * @param {{ stateId?: string }} workItem A RAW backend DTO.
 * @returns {{ actionId: string, fromStateId: string, toStateId: string }|null}
 */
export function resolveSelfAssignTransition(type, workItem) {
  const stateId = workItem?.stateId
  if (type == null || stateId == null) {
    return null
  }
  const currentState = type.states?.find((s) => s.id === stateId)
  if (currentState?.isTerminal) {
    return null
  }
  return (
    (type.transitions ?? []).find(
      (t) => t.startsOnSelfAssign === true && t.fromStateId === stateId
    ) ?? null
  )
}

/**
 * Decide whether an action would be allowed for a work item right now.
 * Returns `{ allowed: true }` or `{ allowed: false, reason }` so callers can
 * surface the failure in a form.
 */
export function canApplyAction(type, workItem, actionId) {
  const transition = (type?.transitions ?? []).find(
    (t) => t.actionId === actionId
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
  if (transition.fromStateId !== stateId) {
    return { allowed: false, reason: 'invalid-transition' }
  }
  // RA-372. Kept in step with the `callerInvocable` filter in
  // `projectWorkItem` above, so the two helpers cannot disagree about
  // whether a caller may ask for an action.
  //
  // NOT a security control for the GENERIC action route, and must not be
  // audited as one. A forged `POST /work-items/{id}/actions/{actionId}`
  // never reaches here — that route goes straight through
  // `core/service.js` to the backend, whose own guard, checked against
  // the work item's frozen template snapshot, is the only thing
  // rejecting it.
  //
  // This helper DOES have a production caller — RA-346's
  // `re-accreditation/approve-eligibility.js` — but that one gates a
  // bespoke endpoint which applies its own server-side check, so the same
  // "backend is authoritative" reading holds. See `docs/work-items.md`.
  if (transition.callerInvocable === false) {
    return { allowed: false, reason: 'not-caller-invocable' }
  }
  return { allowed: true }
}
