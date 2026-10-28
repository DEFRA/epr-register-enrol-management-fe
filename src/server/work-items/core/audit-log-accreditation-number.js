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
