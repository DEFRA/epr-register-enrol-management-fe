/**
 * Audit log rendering for the valid-from date (RA-795 AC08).
 *
 * management-be's `determination-made` entry (written when the regulator
 * approves or refuses in Make determination) carries the valid-from date as
 * `details.effectiveDate` (`YYYY-MM-DD`) when one was entered. A refusal
 * records no valid-from date, so its entry has nothing extra to show.
 */

export const DETERMINATION_MADE_ACTION = 'determination-made'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` -> `dd/mm/yyyy`; anything else yields `null`. */
function formatIsoDate(value) {
  const match = ISO_DATE.exec(String(value ?? ''))
  if (!match) {
    return null
  }
  const [, year, month, day] = match
  return `${day}/${month}/${year}`
}

/**
 * Detail rows for a determination entry: the valid-from date. Who made the
 * determination and when are already in the entry's own header. No date, no
 * rows.
 */
export function determinationMadeRows(entry) {
  const validFrom = formatIsoDate(entry.details?.effectiveDate)
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
