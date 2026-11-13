/**
 * Audit log rendering for accreditation number corrections (RA-691).
 *
 * management-be's one-off RA-691 migration appends an
 * `accreditation-number-corrected` entry (no state change) when it corrects a
 * wrongly generated `accreditationId`, carrying the incorrect (`from`) and
 * corrected (`to`) references plus a `reason`. References are rendered
 * verbatim: they are already the caseworker-facing form (e.g.
 * `A27ER5005270246PL`).
 */

export const ACCREDITATION_NUMBER_CORRECTED_ACTION =
  'accreditation-number-corrected'

/** At-a-glance summary: "old → new" (empty unless both are present). */
export function summariseAccreditationNumberCorrected(details) {
  return details?.from && details?.to ? `${details.from} → ${details.to}` : ''
}

/** Detail rows: previous / corrected number and the reason, when present. */
export function accreditationNumberCorrectedRows(details) {
  return [
    { key: 'Previous accreditation number', value: details?.from },
    { key: 'Corrected accreditation number', value: details?.to },
    { key: 'Reason', value: details?.reason, multiline: true }
  ].filter((row) => row.value)
}

/**
 * Audit log rendering for last year's accreditation number added (RA-763).
 *
 * management-be's one-off RA-763 migration appends a
 * `last-years-accreditation-number-added` entry (no state change) when it
 * gives a 2027 case its 2026 accreditation number from the public register.
 * The case's own 2027 number is derived from it. Details carry the `year`,
 * the `accreditationNumber`, the `source` it was taken from and a `reason`.
 */

export const LAST_YEARS_ACCREDITATION_NUMBER_ADDED_ACTION =
  'last-years-accreditation-number-added'

/** At-a-glance summary: "2026: A26…" (empty without a number). */
export function summariseLastYearsAccreditationNumberAdded(details) {
  if (!details?.accreditationNumber) {
    return ''
  }
  return details.year
    ? `${details.year}: ${details.accreditationNumber}`
    : details.accreditationNumber
}

/** Detail rows: year, number, where it came from and the reason, when present. */
export function lastYearsAccreditationNumberAddedRows(details) {
  return [
    { key: 'Accreditation year', value: details?.year },
    { key: 'Accreditation number', value: details?.accreditationNumber },
    { key: 'Source', value: details?.source },
    { key: 'Reason', value: details?.reason, multiline: true }
  ].filter((row) => row.value)
}
