/**
 * RA-495 AC6: the effective date on the Make determination page, for a type
 * whose `standardLifecycle.effectiveDate` is true (add-ORS; re-accreditation
 * does not take one).
 *
 * An approval must name it: the date the operator's accreditation shows the
 * site as accredited from. RA-795: it must fall between 1 January and
 * 31 December (inclusive) of the work item's accreditation year, so it may be
 * before the submission date or in the future. A refusal is not asked for one
 * (the field is hidden when Refused is selected, and nothing is sent);
 * management-be records the submission date for it.
 *
 * ⚠ THE FOUR ERROR CODES ARE A SHARED CONTRACT WITH management-be, which
 * answers a rejected date with a 400 carrying `errorCode` (one of these) and
 * `field: "effectiveDate"`. The same codes drive the local checks here, so
 * the caseworker sees one sentence per rule whichever side rejects. The local
 * checks matter more than usual: the decision note is posted before the
 * decision, so a date the backend rejected would leave the note behind.
 *
 * The year-bound rule lives in `validateEffectiveDate`, so the Change valid
 * from date page can apply the same one.
 *
 * The range copy is not in Figma (which has no error states); content design
 * has approved it.
 */

import { readDateInput } from '../date-input.js'

export const EFFECTIVE_DATE_FIELD = 'effectiveDate'

/** The GOV.UK date-input component id, and the error-summary anchor. */
export const EFFECTIVE_DATE_ID = 'effective-date'
export const EFFECTIVE_DATE_ANCHOR = `#${EFFECTIVE_DATE_ID}-day`

export const ERROR_REQUIRED = 'effective-date-required'
export const ERROR_INVALID = 'effective-date-invalid'
export const ERROR_BEFORE_YEAR_START = 'effective-date-before-year-start'
export const ERROR_AFTER_YEAR_END = 'effective-date-after-year-end'

const EFFECTIVE_DATE_MESSAGES = {
  [ERROR_REQUIRED]: () => 'Enter the valid from date',
  [ERROR_INVALID]: () => 'Valid from date must be a real date',
  [ERROR_BEFORE_YEAR_START]: (year) =>
    year == null
      ? null
      : `Valid from date must be on or after 1 January ${year}`,
  [ERROR_AFTER_YEAR_END]: (year) =>
    year == null
      ? null
      : `Valid from date must be on or before 31 December ${year}`
}

/**
 * Is this an effective-date rejection from management-be (bind it to the
 * field), or something else (a banner)?
 */
export function isEffectiveDateErrorCode(code) {
  return typeof code === 'string' && code in EFFECTIVE_DATE_MESSAGES
}

/**
 * The sentence for an effective-date error code, or null for an unknown code
 * (or a year-named range code with no year to name).
 *
 * @param {string} code
 * @param {number | null | undefined} accreditationYear
 */
export function effectiveDateMessage(code, accreditationYear) {
  return EFFECTIVE_DATE_MESSAGES[code]?.(accreditationYear) ?? null
}

/**
 * The accreditation year a work item was submitted with, or null when it is
 * missing or not a 4-digit whole number (management-be then answers a date
 * with a server error).
 *
 * @param {{ payload?: { accreditationYear?: unknown } } | null | undefined} workItem
 * @returns {number | null}
 */
export function accreditationYearOf(workItem) {
  const year = workItem?.payload?.accreditationYear
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null
}

/**
 * Validate the three boxes against the work item's accreditation year:
 * required, a real date, then 1 January to 31 December of that year inclusive.
 *
 * @param {{ day?: string, month?: string, year?: string }} values
 * @param {number | null | undefined} accreditationYear see
 *   `accreditationYearOf`. When it is unreadable the bounds are left to
 *   management-be, which always has it.
 * @returns {{ ok: true, value: string } | { ok: false, errorCode: string }}
 */
export function validateEffectiveDate(values, accreditationYear) {
  const read = readDateInput(values)
  if (!read.ok) {
    return {
      ok: false,
      errorCode: read.error === 'required' ? ERROR_REQUIRED : ERROR_INVALID
    }
  }

  if (
    Number.isInteger(accreditationYear) &&
    accreditationYear >= 1000 &&
    accreditationYear <= 9999
  ) {
    if (read.utcTime < Date.UTC(accreditationYear, 0, 1)) {
      return { ok: false, errorCode: ERROR_BEFORE_YEAR_START }
    }
    if (read.utcTime > Date.UTC(accreditationYear, 11, 31)) {
      return { ok: false, errorCode: ERROR_AFTER_YEAR_END }
    }
  }

  return { ok: true, value: read.value }
}
