/**
 * Routes for the re-accreditation duly-making flow (RA-316): the shared Standard-lifecycle
 * pages (RA-495) at `/work-items/re-accreditation/{id}/duly-make`. They post to
 * re-accreditation's own endpoint, the one its type declares
 * (`standardLifecycle.backend`).
 */

import { buildDulyMakingRoutes as buildStandardDulyMakingRoutes } from '../../core/standard-lifecycle/duly-making/routes.js'
import { RE_ACCREDITATION_TYPE_ID } from '../type-id.js'

export function buildDulyMakingRoutes() {
  return buildStandardDulyMakingRoutes(RE_ACCREDITATION_TYPE_ID)
}
