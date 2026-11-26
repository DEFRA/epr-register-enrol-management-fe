/**
 * Audit log rendering for the valid-from date (RA-795 AC08).
 *
 * management-be's `determination-made` entry (written when the regulator
 * approves or refuses in Make determination) carries `details.effectiveDate`
 * (`YYYY-MM-DD`) for a type that takes a valid-from date. Only on an approval
 * is it the valid-from date: a refusal's is the submission date, kept for
 * audit, so its entry has nothing extra to show (RA-795 AC10).
 */

import { formatIsoDate } from './format-iso-date.js'

export const DETERMINATION_MADE_ACTION = 'determination-made'

/**
 * Detail rows for a determination entry: an approval's valid-from date. Who
 * made the determination and when are already in the entry's own header. No
 * approval or no date, no rows.
 */
export function determinationMadeRows(entry) {
  if (entry.details?.outcome !== 'approved') {
    return []
  }
  const validFrom = formatIsoDate(entry.details.effectiveDate)
  return validFrom ? [{ key: 'Valid from date', value: validFrom }] : []
}

/**
 * Valid-from corrections (RA-800 AC07): management-be stamps a dedicated
 * `valid-from-changed` entry (not a state transition) carrying
 * `previousEffectiveDate`, `effectiveDate` and the reason.
 */
export const VALID_FROM_CHANGED_ACTION = 'valid-from-changed'

/** At-a-glance summary: "01/06/2027 → 15/06/2027" (empty if either is bad). */
export function summariseValidFromChanged(details) {
  const previous = formatIsoDate(details?.previousEffectiveDate)
  const next = formatIsoDate(details?.effectiveDate)
  return previous && next ? `${previous} → ${next}` : ''
}

/** Detail rows: previous / new date, actor and a multiline reason. */
export function validFromChangedRows(entry) {
  const details = entry.details ?? {}
  const rows = [
    {
      key: 'Previous valid from date',
      value: formatIsoDate(details.previousEffectiveDate)
    },
    { key: 'New valid from date', value: formatIsoDate(details.effectiveDate) },
    { key: 'Changed by', value: entry.createdByName ?? entry.createdBy }
  ].filter((row) => row.value)

  if (typeof details.reason === 'string' && details.reason.trim() !== '') {
    // Browsers normalise a `<textarea>` to CRLF on submit; the template splits
    // on `\n`, so normalise back to avoid a stray carriage return.
    rows.push({
      key: 'Reason',
      value: details.reason.replaceAll('\r\n', '\n'),
      multiline: true
    })
  }
  return rows
}
