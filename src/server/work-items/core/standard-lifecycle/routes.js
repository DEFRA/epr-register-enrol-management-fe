/**
 * RA-495. Every Standard-lifecycle page for one type: Duly make, Make
 * determination and Confirm applicant contact, under
 * `/work-items/{typeId}/{id}/…`. A type that opts in (`standardLifecycle` on
 * its type, see `./lifecycle.js`) mounts these from its module's
 * `register(server)`.
 */

import { buildConfirmContactRoutes } from './confirm-contact/routes.js'
import { buildDecisionRoutes } from './decision/routes.js'
import { buildDulyMakingRoutes } from './duly-making/routes.js'

/**
 * The detail template for a Standard-lifecycle type with no detail page of
 * its own: the generic page plus the lifecycle CTAs and the pending-contact
 * banner. A type's own template can extend it the same way.
 */
export const STANDARD_LIFECYCLE_DETAIL_TEMPLATE = 'standard-lifecycle/detail'

/**
 * @param {string} typeId
 * @returns {object[]} Hapi route definitions
 */
export function buildStandardLifecycleRoutes(typeId) {
  return [
    ...buildDulyMakingRoutes(typeId),
    ...buildDecisionRoutes(typeId),
    ...buildConfirmContactRoutes(typeId)
  ]
}
