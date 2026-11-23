/**
 * RA-495. Re-accreditation's management-be calls for the shared
 * Standard-lifecycle pages: its own type-scoped endpoints
 * (`/work-items/re-accreditation/{id}/duly-make|decision|confirm-contact`),
 * which refuse any other type.
 */

import { buildLifecycleBackend } from '../core/standard-lifecycle/lifecycle.js'
import { RE_ACCREDITATION_TYPE_ID } from './type-id.js'

export const reAccreditationLifecycleBackend = buildLifecycleBackend(
  RE_ACCREDITATION_TYPE_ID
)
