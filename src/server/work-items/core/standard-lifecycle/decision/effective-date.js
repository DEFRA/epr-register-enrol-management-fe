/**
 * RA-495 AC6: the effective date on the Make determination page, for a type
 * whose `standardLifecycle.effectiveDate` is true (add-ORS; re-accreditation
 * does not take one).
 *
 * An approval must name it: the date the operator's accreditation shows the
 * site as accredited from. It may be in the past or the future, but not
 * before the UK calendar date the request was submitted. A refusal is not
 * asked for one (the field is hidden when Refused is selected, and nothing is
 * sent); management-be records the submission date for it.
 *
 * ⚠ THE THREE ERROR CODES ARE A SHARED CONTRACT WITH management-be, which
 * answers a rejected date with a 400 carrying `errorCode` (one of these) and
 * `field: "effectiveDate"`. The same codes drive the local checks here, so
 * the caseworker sees one sentence per rule whichever side rejects. The local
 * checks matter more than usual: the decision note is posted before the
 * decision, so a date the backend rejected would leave the note behind.
 *
 * The copy is not in Figma (which has no error states): it is pending
 * content design review.
 */

import { readDateInput } from '../date-input.js'

export const EFFECTIVE_DATE_FIELD = 'effectiveDate'

/** The GOV.UK date-input component id, and the error-summary anchor. */
export const EFFECTIVE_DATE_ID = 'effective-date'
export const EFFECTIVE_DATE_ANCHOR = `#${EFFECTIVE_DATE_ID}-day`

export const ERROR_REQUIRED = 'effective-date-required'
export const ERROR_INVALID = 'effective-date-invalid'
export const ERROR_BEFORE_SUBMISSION = 'effective-date-before-submission'

export const EFFECTIVE_DATE_MESSAGES = {
  [ERROR_REQUIRED]: 'Enter the effective date',
  [ERROR_INVALID]: 'Effective date must be a real date',
  [ERROR_BEFORE_SUBMISSION]:
    'Effective date must be on or after the date the request was submitted'
}

/**
 * Is this an effective-date rejection from management-be (bind it to the
 * field), or something else (a banner)?
 */
export function isEffectiveDateErrorCode(code) {
  return typeof code === 'string' && code in EFFECTIVE_DATE_MESSAGES
}

export function effectiveDateMessage(code) {
  return EFFECTIVE_DATE_MESSAGES[code] ?? null
}

const ukDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/**
 * The UTC midnight of an instant's Europe/London calendar date, as
 * management-be reads the submission date (`UkCalendar.DateOf`).
 */
function ukCalendarDay(instant) {
  const parts = Object.fromEntries(
    ukDateFormatter.formatToParts(instant).map((p) => [p.type, p.value])
  )
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  )
}

/**
 * Validate the three boxes against the work item's submission date.
 *
 * @param {{ day?: string, month?: string, year?: string }} values
 * @param {string | null | undefined} submittedAt the work item's ISO
 *   `submittedAt`. When it is missing or unreadable the floor is left to
 *   management-be, which always has it.
 * @returns {{ ok: true, value: string } | { ok: false, errorCode: string }}
 */
export function validateEffectiveDate(values, submittedAt) {
  const read = readDateInput(values)
  if (!read.ok) {
    return {
      ok: false,
      errorCode: read.error === 'required' ? ERROR_REQUIRED : ERROR_INVALID
    }
  }

  const submitted = submittedAt ? new Date(submittedAt) : null
  if (
    submitted &&
    !Number.isNaN(submitted.getTime()) &&
    read.utcTime < ukCalendarDay(submitted)
  ) {
    return { ok: false, errorCode: ERROR_BEFORE_SUBMISSION }
  }

  return { ok: true, value: read.value }
}
