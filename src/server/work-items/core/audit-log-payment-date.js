/**
 * Audit log rendering for payment date changes (RA-576).
 *
 * management-be's change-payment-date service stamps a dedicated
 * `payment-date-changed` entry (not a state transition, so no from / to
 * states) carrying the previous and new dates and the reason.
 */

import { formatIsoDate } from './format-iso-date.js'

export const PAYMENT_DATE_CHANGED_ACTION = 'payment-date-changed'

/** At-a-glance summary: "15/07/2026 → 20/07/2026" (empty if either is bad). */
export function summarisePaymentDateChanged(details) {
  const previous = formatIsoDate(details?.previousPaymentDate)
  const next = formatIsoDate(details?.paymentDate)
  return previous && next ? `${previous} → ${next}` : ''
}

/** Detail rows: previous / new date, actor and a multiline reason. */
export function paymentDateChangedRows(entry) {
  const details = entry.details ?? {}
  const rows = [
    {
      key: 'Previous payment date',
      value: formatIsoDate(details.previousPaymentDate)
    },
    { key: 'New payment date', value: formatIsoDate(details.paymentDate) },
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
