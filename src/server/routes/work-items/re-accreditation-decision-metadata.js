/**
 * Approved-item display metadata for a re-accreditation work item — Granted
 * (`approved`) or, since RA-527, approved at step 1 and awaiting applicant
 * contact (`approved-pending-contact`), when the number is already minted.
 *
 * Split out of `detail.controller.js` (RA-523) because it answers a
 * different question from everything around it: the rest of that file
 * decides WHICH controls render, while this formats the record of a
 * decision already taken. It also owns the only date-formatting and
 * Mongo-shape handling on that path, so keeping it here confines both to
 * one place instead of leaving them in a controller that has no other use
 * for either.
 *
 * Returns `null` for anything that is not an approved item carrying at
 * least one of the three fields, so the template renders no panel rather
 * than an empty one.
 */

import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { unwrapMongoDate } from '#/server/common/helpers/format/mongo-date.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { STATE_APPROVED_PENDING_CONTACT } from '#/server/work-items/re-accreditation/states.js'

// Its own logger instance rather than one passed in: this module is a pure
// formatter with a single caller, and threading a logger through the call
// would put a parameter on it for the sake of one warning.
const logger = createLogger()

// RA-527. The accreditation number is minted and stamped at step 1, so the
// ID row shows while the approval awaits applicant contact as well as once it
// is Granted. The start date and year are stamped at step 2 (task 007), so
// their rows show only once Granted (`showIssuedDetails`) — even if an item
// from an earlier build still carries step 1 values for them.
const APPROVED_STATE_IDS = new Set(['approved', STATE_APPROVED_PENDING_CONTACT])

export function buildDecisionMetadata(workItem) {
  if (!APPROVED_STATE_IDS.has(workItem.stateId)) {
    return null
  }

  const payload = workItem.payload ?? {}
  const accreditationId = payload.accreditationId ?? null
  // RA-176: the backend stamps this as a plain ISO date string, but older
  // work items arrive as MongoDB extended JSON (`{ $date: '...' }`), which
  // would string-coerce to "[object Object]" in the panel if left unhandled.
  const accreditationStartDate = unwrapMongoDate(payload.accreditationStartDate)
  // RA-133: backend now stamps the accreditation year alongside the id
  // and start date so the UI can display the year independently of the
  // (locally-formatted) start date.
  const accreditationYear =
    typeof payload.accreditationYear === 'number'
      ? payload.accreditationYear
      : null

  if (
    !accreditationId &&
    !accreditationStartDate &&
    accreditationYear === null
  ) {
    return null
  }

  let accreditationStartDateFormatted = '—'
  if (accreditationStartDate) {
    try {
      accreditationStartDateFormatted = formatDate(
        accreditationStartDate,
        'd MMMM yyyy'
      )
    } catch (err) {
      // Backend produced a value we can't parse; fall back to the raw
      // ISO string so the user still sees something rather than a
      // template render error. Log it so ops can spot bad data.
      logger.warn(
        { err, accreditationStartDate, workItemId: workItem.id },
        'Re-accreditation accreditationStartDate could not be formatted'
      )
      accreditationStartDateFormatted = String(accreditationStartDate)
    }
  }

  return {
    showIssuedDetails: workItem.stateId !== STATE_APPROVED_PENDING_CONTACT,
    accreditationId: accreditationId ?? '—',
    accreditationStartDate,
    accreditationStartDateFormatted,
    accreditationYear
  }
}
