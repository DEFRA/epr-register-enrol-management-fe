/**
 * Re-accreditation duly-making service (RA-316). RA-495: the shared
 * Standard-lifecycle service, calling re-accreditation's own endpoint by
 * default.
 */

import { createDulyMakingService as createStandardDulyMakingService } from '../../core/standard-lifecycle/duly-making/service.js'
import { reAccreditationLifecycleBackend } from '../lifecycle-backend.js'

export function createDulyMakingService({
  dulyMake = reAccreditationLifecycleBackend.dulyMake
} = {}) {
  return createStandardDulyMakingService({ dulyMake })
}
