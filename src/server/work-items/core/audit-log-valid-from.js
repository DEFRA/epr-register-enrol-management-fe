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
 * Detail rows for a determination entry: the valid-from date and who set it
 * (the timestamp is the entry's own). No date, no rows.
 */
export function determinationMadeRows(entry) {
  const validFrom = formatIsoDate(entry.details?.effectiveDate)
  if (!validFrom) {
    return []
  }
  const rows = [{ key: 'Valid from date', value: validFrom }]
  const actor = entry.createdByName ?? entry.createdBy
  if (actor) {
    rows.push({ key: 'Determined by', value: actor })
  }
  return rows
}
