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
