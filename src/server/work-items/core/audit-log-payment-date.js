/**
 * Audit log rendering for payment date changes (RA-576).
 *
 * management-be's change-payment-date service stamps an `action-applied`
 * entry whose from and to states are identical, plus the previous and new
 * dates and the reason. Rendered with the generic `action-applied` rules it
 * would read "(Duly made → Duly made)", so `audit-log.js` hands these entries
 * to the helpers here instead.
 */

export const CHANGE_PAYMENT_DATE_ACTION_ID = 'change-payment-date'

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

export function isChangePaymentDateEntry(details) {
  return details?.actionId === CHANGE_PAYMENT_DATE_ACTION_ID
}

/** A payment date change is not a state change, so it reads "(updated)". */
export function summariseChangePaymentDate(details) {
  const action = details.actionDisplayName ?? details.actionId
  return `${action} (updated)`
}

/** Detail rows: the action, previous / new date, actor and a multiline reason. */
export function changePaymentDateRows(entry) {
  const details = entry.details ?? {}
  const rows = [
    { key: 'Action', value: details.actionDisplayName ?? details.actionId },
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
