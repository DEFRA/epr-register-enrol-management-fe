/**
 * Approved-item display metadata for a re-accreditation work item.
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

// Its own logger instance rather than one passed in: this module is a pure
// formatter with a single caller, and threading a logger through the call
// would put a parameter on it for the sake of one warning.
const logger = createLogger()

export function buildDecisionMetadata(workItem) {
  if (workItem.stateId !== 'approved') {
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
    accreditationId: accreditationId ?? '—',
    accreditationStartDate,
    accreditationStartDateFormatted,
    accreditationYear
  }
}
