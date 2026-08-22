import { format, isDate, parseISO } from 'date-fns'
import { tz } from '@date-fns/tz'

/**
 * The IANA timezone all user-facing timestamps are rendered in.
 *
 * The backend stores and returns every timestamp in UTC. This module is the
 * single point at which we convert those UTC instants to the user-facing
 * wall-clock zone for display. Using the IANA 'Europe/London' zone (rather
 * than a fixed offset) makes British Summer Time (BST = UTC+1) and GMT
 * (UTC+0) — and the spring-forward / autumn-back DST transitions between
 * them — automatic, and keeps the result correct regardless of the server's
 * own TZ (production servers run UTC).
 */
export const UK_TIMEZONE = 'Europe/London'

export function formatDate(value, formattedDateStr = 'EEE do MMMM yyyy') {
  const date = isDate(value) ? value : parseISO(value)

  return format(date, formattedDateStr, { in: tz(UK_TIMEZONE) })
}

/**
 * Format an ISO-8601 date-time string in the GDS-recommended date-time
 * format: "D MMMM YYYY at h:mma" (e.g. "27 April 2026 at 10:00am").
 *
 * The backend is UTC; this converts to UK local time (see UK_TIMEZONE) so
 * BST and GMT — and the DST transitions — render correctly without relying
 * on the server's TZ.
 *
 * Returns an empty string when the value is absent or unparseable, so it is
 * safe to use directly in Nunjucks templates without a guard:
 *   {{ item.submittedAt | formatDateTimeGds }}
 */
export function formatDateTimeGds(value) {
  if (!value) {
    return ''
  }
  const date = isDate(value) ? value : parseISO(value)
  if (isNaN(date.getTime())) {
    return ''
  }
  return format(date, "d MMMM yyyy 'at' h:mmaaa", { in: tz(UK_TIMEZONE) })
}

/**
 * Format an ISO-8601 date(-time) string in the GDS-recommended *date* format:
 * "D MMMM YYYY" (e.g. "16 July 2026") — date only, no time component.
 *
 * Used for the "Submitted on" tile field (RA-324, AC05.6). The guard parses
 * with the SAME parser used to format (date-fns `parseISO`), so a value the
 * guard accepts can never throw in `format` — returns an empty string for an
 * absent or unparseable value, safe to use directly in a template without a
 * surrounding guard.
 */
export function formatDateGds(value) {
  if (!value) {
    return ''
  }
  const date = isDate(value) ? value : parseISO(value)
  if (isNaN(date.getTime())) {
    return ''
  }
  return format(date, 'd MMMM yyyy', { in: tz(UK_TIMEZONE) })
}
