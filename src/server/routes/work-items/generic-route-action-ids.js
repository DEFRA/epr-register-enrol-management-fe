/**
 * The action-id categories the generic
 * `POST /work-items/{id}/actions/{actionId}` route never forwards to the
 * backend (RA-317, RA-000). Used by `makeApplyActionController` to reject
 * them and by `decorate` to strip withdraw from `availableActions`.
 */
import { isQueryActionId } from './re-accreditation-cta.js'

// RA-317. Withdraw is an OPERATOR action; Case Management must never show it
// or apply it, in any state. This helper backs both halves of that:
//   1. `decorate` strips `withdraw`/`withdraw-*` from `availableActions`, so
//      no withdraw affordance ever renders (and a withdraw-only state falls
//      through to the honest "No actions available" empty state).
//   2. `makeApplyActionController` rejects the same ids before the backend is
//      called, so a crafted POST that bypasses the UI cannot withdraw.
// Unlike every OTHER action id (which the apply-action route deliberately
// forwards to the backend as authoritative — see its docstring in
// `detail.controller.js`), this is not moving an authorisation decision into
// the wrong tier: the whole
// ACTION CATEGORY is absent from the Case Management service, so refusing it
// here is the correct place.
// Kept as a local helper rather than importing the now-deleted
// withdraw.service.js, so the removed Case Management service withdraw
// journey leaves no dead code.
const WITHDRAW_ACTION_PREFIX = 'withdraw'

export function isWithdrawActionId(actionId) {
  return (
    typeof actionId === 'string' &&
    (actionId === WITHDRAW_ACTION_PREFIX ||
      actionId.startsWith(`${WITHDRAW_ACTION_PREFIX}-`))
  )
}

// RA-000. Resume is, like withdraw, an OPERATOR action: the four
// `resume-during-*` transitions are applied by management-be when the
// operator resubmits a queried application, and no Case Management journey
// applies them. Rejected on the generic route for the same reason withdraw is.
const RESUME_ACTION_PREFIX = 'resume'

function isResumeActionId(actionId) {
  return (
    typeof actionId === 'string' &&
    (actionId === RESUME_ACTION_PREFIX ||
      actionId.startsWith(`${RESUME_ACTION_PREFIX}-`))
  )
}

// RA-000. The action ids the generic apply-action route never forwards.
// Each is a whole action CATEGORY with no generic-route use in Case
// Management, so — per the RA-317 note above — refusing it here does not
// move an authorisation decision into this tier:
//   - withdraw / resume: operator actions, absent from Case Management.
//   - query: Case Management queries ONLY through `POST /work-items/{id}/query`
//     (query.controller.js), whose backend query service self-assigns,
//     stamps `currentQuery` and writes the `application-queried` audit
//     entry. A `query-*` id applied generically skips all three, and the
//     operator push then sends an empty or a previous query.
// Every other id is still forwarded; the backend's own guard stays
// authoritative for it (see the docstring above `makeApplyActionController` in
// `detail.controller.js`).
export function isGenericRouteRejectedActionId(actionId) {
  return (
    isWithdrawActionId(actionId) ||
    isQueryActionId(actionId) ||
    isResumeActionId(actionId)
  )
}
