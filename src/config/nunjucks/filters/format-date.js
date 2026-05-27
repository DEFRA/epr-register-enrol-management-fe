import { format, isDate, parseISO } from 'date-fns'

export function formatDate(value, formattedDateStr = 'EEE do MMMM yyyy') {
  const date = isDate(value) ? value : parseISO(value)

  return format(date, formattedDateStr)
}

/**
 * Format an ISO-8601 date-time string in the GDS-recommended date-time
 * format: "D MMMM YYYY at h:mma" (e.g. "27 April 2026 at 10:00am").
 *
 * Returns an empty string when the value is absent or unparseable, so it is
 * safe to use directly in Nunjucks templates without a guard:
 *   {{ item.submittedAt | formatDateTimeGds }}
 */
export function formatDateTimeGds(value) {
  if (!value) return ''
  const date = isDate(value) ? value : parseISO(value)
  if (isNaN(date.getTime())) return ''
  return format(date, "d MMMM yyyy 'at' h:mmaaa")
}
