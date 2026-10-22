/**
 * RA-527. Re-accreditation state ids that code outside `module.js` needs to
 * name. Kept in this dependency-free file (rather than exported from
 * `module.js`, which pulls in the type's routes and controllers) so a
 * controller or formatter can import one without risking an import cycle.
 * `module.js` declares its STATES from these same constants.
 */

/**
 * Step 1 of the two-step determination: approved and the accreditation
 * number minted, but the applicant not yet contacted. Not terminal.
 */
export const STATE_APPROVED_PENDING_CONTACT = 'approved-pending-contact'

/**
 * The states in which a determination has been made (step 1) but not yet
 * applied, because the applicant has not been contacted. Not closed: the
 * case stays reassignable so someone else can make the contact, and
 * "Confirm applicant contact" (step 2) is the only way on. One list, read by
 * the detail page and the confirm-contact routes alike.
 */
export const PENDING_CONTACT_STATE_IDS = Object.freeze(
  new Set([STATE_APPROVED_PENDING_CONTACT])
)

/**
 * Is the work item a re-accreditation awaiting confirmation of applicant
 * contact?
 *
 * @param {{ typeId?: string, stateId?: string } | null | undefined} workItem
 * @returns {boolean}
 */
export function isPendingContact(workItem) {
  return (
    workItem?.typeId === 're-accreditation' &&
    PENDING_CONTACT_STATE_IDS.has(workItem.stateId)
  )
}
