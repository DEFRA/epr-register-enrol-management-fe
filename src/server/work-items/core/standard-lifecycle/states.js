/**
 * RA-527. Standard-workflow state ids and groupings that code outside the
 * workflow declaration needs to name. Kept apart from the modules, which pull
 * in their routes and controllers, so a controller or formatter can import
 * them without risking an import cycle. RA-495: shared by every type on the
 * Standard lifecycle (re-accreditation's `states.js` re-exports them).
 */

import {
  STATE_APPROVED_PENDING_CONTACT,
  STATE_REJECTED_PENDING_CONTACT
} from '../standard-workflow.js'

export { STATE_APPROVED_PENDING_CONTACT, STATE_REJECTED_PENDING_CONTACT }

/**
 * The states in which a determination has been made (step 1) but not yet
 * applied, because the applicant has not been contacted. Not closed: the
 * case stays reassignable so someone else can make the contact, and
 * "Confirm applicant contact" (step 2) is the only way on. One list, read by
 * the detail page and the confirm-contact routes alike.
 */
export const PENDING_CONTACT_STATE_IDS = new Set([
  STATE_APPROVED_PENDING_CONTACT,
  STATE_REJECTED_PENDING_CONTACT
])

/**
 * Is the work item a `typeId` work item awaiting confirmation of applicant
 * contact?
 *
 * @param {{ typeId?: string, stateId?: string } | null | undefined} workItem
 * @param {{ typeId: string }} scope the type whose page is asking
 * @returns {boolean}
 */
export function isPendingContact(workItem, { typeId }) {
  return (
    workItem?.typeId === typeId &&
    PENDING_CONTACT_STATE_IDS.has(workItem.stateId)
  )
}
