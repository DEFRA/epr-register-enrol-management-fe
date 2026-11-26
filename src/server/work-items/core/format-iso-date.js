const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A plain `YYYY-MM-DD` date as `dd/mm/yyyy`; anything else yields `null`. */
export function formatIsoDate(value) {
  const match = ISO_DATE.exec(String(value ?? ''))
  if (!match) {
    return null
  }
  const [, year, month, day] = match
  return `${day}/${month}/${year}`
}
