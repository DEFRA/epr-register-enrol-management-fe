/**
 * Routes for the re-accreditation confirm-contact flow (RA-527): the shared Standard-lifecycle
 * pages (RA-495) at `/work-items/re-accreditation/{id}/confirm-contact`. They post to
 * re-accreditation's own endpoint, the one its type declares
 * (`standardLifecycle.backend`).
 */

import { buildConfirmContactRoutes as buildStandardConfirmContactRoutes } from '../../core/standard-lifecycle/confirm-contact/routes.js'
import { RE_ACCREDITATION_TYPE_ID } from '../type-id.js'

export function buildConfirmContactRoutes() {
  return buildStandardConfirmContactRoutes(RE_ACCREDITATION_TYPE_ID)
}
