/**
 * The action ids the generic `POST /work-items/{id}/actions/{actionId}`
 * route never forwards to the backend (RA-317, RA-000), and the params
 * validation that keeps those checks sound.
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
import Boom from '@hapi/boom'
import Joi from 'joi'

import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

// Every action id is lower-case kebab. management-be resolves action ids
// case-insensitively, so without this a `Withdraw` or `Query-During-Decision`
// would slip past the case-sensitive prefix checks below and be applied.
const ACTION_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

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

/**
 * Route `options.validate` for the generic apply-action route. An action id
 * that is not lower-case kebab is refused before the handler runs: logged at
 * Error and answered with the generic 400 error page.
 */
export const applyActionParamsValidation = {
  params: Joi.object({
    id: Joi.string().required(),
    actionId: Joi.string().pattern(ACTION_ID_PATTERN).required()
  }),
  failAction(request, _h, err) {
    logger.error(
      {
        workItemId: request.params.id,
        actionId: request.params.actionId,
        route: request.route.path,
        reason: err.message
      },
      'Rejected a malformed action id on the generic apply-action route'
    )
    throw Boom.badRequest('Invalid action id')
  }
}
