/**
 * Reason validation for the Change valid from date page (RA-800).
 *
 * The page carries no browser JavaScript (RA-94), so the 200-word limit
 * `govukCharacterCount` advertises is enforced here, server-side, and again
 * by management-be. The two codes are a shared contract with the backend
 * (`field: "reason"`).
 */

export const REASON_ID = 'reason'
export const REASON_ANCHOR = `#${REASON_ID}`

export const ERROR_REASON_REQUIRED = 'effective-date-reason-required'
export const ERROR_REASON_TOO_LONG = 'effective-date-reason-too-long'

export const MAX_REASON_WORDS = 200

// Not in Figma (which has no error states): pending content design review.
export const REASON_MESSAGES = {
  [ERROR_REASON_REQUIRED]: 'Enter a reason for the valid from date change',
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
