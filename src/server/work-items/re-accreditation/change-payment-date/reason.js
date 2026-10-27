/**
 * Reason validation for the change-payment-date page (RA-576).
 *
 * The page carries no browser JavaScript (RA-94), so the 200-word limit
 * `govukCharacterCount` advertises is enforced here, server-side, and again
 * by management-be. The two codes are a shared contract with the backend
 * (`field: "reason"`).
 */

export const REASON_ID = 'reason'
export const REASON_ANCHOR = `#${REASON_ID}`

export const ERROR_REASON_REQUIRED = 'payment-date-reason-required'
export const ERROR_REASON_TOO_LONG = 'payment-date-reason-too-long'

export const MAX_REASON_WORDS = 200

export const REASON_MESSAGES = {
  [ERROR_REASON_REQUIRED]: 'Enter a reason for the payment date change',
  [ERROR_REASON_TOO_LONG]: `Reason must be ${MAX_REASON_WORDS} words or fewer`
}

export function isReasonErrorCode(code) {
  return typeof code === 'string' && code in REASON_MESSAGES
}

export function messageForReasonErrorCode(code) {
  return REASON_MESSAGES[code] ?? null
}

export function countWords(text) {
  const trimmed = String(text ?? '').trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/**
 * @param {string} [text] The raw textarea value.
 * @returns {{ ok: true, value: string } | { ok: false, errorCode: string }}
 *   `value` is trimmed with CRLF normalised to LF.
 */
export function validateReason(text) {
  const value = String(text ?? '')
    .replaceAll('\r\n', '\n')
    .trim()
  if (value === '') {
    return { ok: false, errorCode: ERROR_REASON_REQUIRED }
  }
  if (countWords(value) > MAX_REASON_WORDS) {
    return { ok: false, errorCode: ERROR_REASON_TOO_LONG }
  }
  return { ok: true, value }
}
