/**
 * Re-accreditation decision service (RA-410). RA-495: the shared
 * Standard-lifecycle service, calling re-accreditation's own endpoint by
 * default.
 */

import { createDecisionService as createStandardDecisionService } from '../../core/standard-lifecycle/decision/service.js'
import { reAccreditationLifecycleBackend } from '../lifecycle-backend.js'

export { DECISION_NOTE_MAX_LENGTH } from '../../core/standard-lifecycle/decision/service.js'

export function createDecisionService({
  recordDecision = reAccreditationLifecycleBackend.recordDecision,
  addNote
} = {}) {
  return createStandardDecisionService({ recordDecision, addNote })
}
