/**
 * Routes for the re-accreditation log-decision flow (RA-410): the shared Standard-lifecycle
 * pages (RA-495) at `/work-items/re-accreditation/{id}/decision`. They post to
 * re-accreditation's own endpoint, the one its type declares
 * (`standardLifecycle.backend`).
 */

import { buildDecisionRoutes as buildStandardDecisionRoutes } from '../../core/standard-lifecycle/decision/routes.js'
import { RE_ACCREDITATION_TYPE_ID } from '../type-id.js'

export function buildDecisionRoutes() {
  return buildStandardDecisionRoutes(RE_ACCREDITATION_TYPE_ID)
}
