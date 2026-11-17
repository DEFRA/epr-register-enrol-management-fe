/**
 * Re-accreditation confirm-contact service (RA-527). RA-495: the shared
 * Standard-lifecycle service, calling re-accreditation's own endpoint by
 * default.
 */

import { createConfirmContactService as createStandardConfirmContactService } from '../../core/standard-lifecycle/confirm-contact/service.js'
import { reAccreditationLifecycleBackend } from '../lifecycle-backend.js'

export function createConfirmContactService({
  confirmContact = reAccreditationLifecycleBackend.confirmContact
} = {}) {
  return createStandardConfirmContactService({ confirmContact })
}
