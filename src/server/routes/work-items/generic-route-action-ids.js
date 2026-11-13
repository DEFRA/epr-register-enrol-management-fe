/**
 * The action ids the generic `POST /work-items/{id}/actions/{actionId}`
 * route never forwards to the backend (RA-317, RA-000), and the lower-case
 * kebab shape every action id has. The route's params validation, which
 * enforces that shape, lives with the route in `index.js`.
 *
 * Each refused id is a whole action CATEGORY with no generic-route use in
 * Case Management. Every other id is forwarded and the backend's own guard
 * stays authoritative for it (see the docstring above
 * `makeApplyActionController` in `detail.controller.js`). Refusing these is
 * not moving an authorisation decision into this tier, because nothing in
 * Case Management legitimately applies them here:
 *   - withdraw (RA-317): an OPERATOR action. `decorate` also strips
 *     `withdraw`/`withdraw-*` from `availableActions`, so no withdraw
 *     affordance renders and a withdraw-only state falls through to the
 *     "No actions available" empty state.
 *   - resume (RA-000): the four `resume-during-*` transitions are applied by
 *     management-be when the operator resubmits a queried application.
 *   - query (RA-000): Case Management queries ONLY through
 *     `POST /work-items/{id}/query`, whose backend query service
 *     self-assigns, stamps `currentQuery` and writes the
 *     `application-queried` audit entry. A `query-*` id applied generically
 *     skips all three, and the operator push then sends an empty or a
 *     previous query.
 */
// Every action id is lower-case kebab. management-be resolves action ids
// case-insensitively, so without this a `Withdraw` or `Query-During-Decision`
// would slip past the case-sensitive prefix checks below and be applied.
export const ACTION_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** `prefix` itself, or `prefix-<anything>`. */
function hasActionIdPrefix(actionId, prefix) {
  return (
    typeof actionId === 'string' &&
    (actionId === prefix || actionId.startsWith(`${prefix}-`))
  )
}

export function isWithdrawActionId(actionId) {
  return hasActionIdPrefix(actionId, 'withdraw')
}

export function isQueryActionId(actionId) {
  return hasActionIdPrefix(actionId, 'query')
}

export function isResumeActionId(actionId) {
  return hasActionIdPrefix(actionId, 'resume')
}

export function isGenericRouteRejectedActionId(actionId) {
  return (
    isWithdrawActionId(actionId) ||
    isQueryActionId(actionId) ||
    isResumeActionId(actionId)
  )
}
