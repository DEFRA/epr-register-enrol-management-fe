/**
 * RA-527. Re-accreditation state ids and groupings that code outside
 * `module.js` needs to name. RA-495: they are the shared Standard-lifecycle
 * ones (`standard-lifecycle/states.js`), re-exported so re-accreditation code
 * keeps naming them from here.
 */

export {
  PENDING_CONTACT_STATE_IDS,
  STATE_APPROVED_PENDING_CONTACT,
  STATE_REJECTED_PENDING_CONTACT
} from '../core/standard-lifecycle/states.js'
