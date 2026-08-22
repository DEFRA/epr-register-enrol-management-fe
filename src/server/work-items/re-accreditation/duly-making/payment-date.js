/**
 * Payment-date validation and payment-details formatting for the
 * re-accreditation duly-making page (RA-316).
 *
 * Server-side validation is mandatory: the page carries no browser
 * JavaScript (RA-94), so a `govukDateInput` is three plain text boxes and
 * nothing stops a malformed submission reaching the handler.
 *
 * ⚠ THE FOUR ERROR CODES ARE A SHARED CONTRACT WITH THE BACKEND.
 *
 * management-be answers every payment-date rejection with HTTP 400, an
 * RFC 7807 ProblemDetails body, and two extension members: `errorCode`
 * (one of the four below) and `field: "paymentDate"`. Its `detail` string
 * is developer-facing and must be LOGGED, never rendered.
 *
 * The frontend owns the user-facing copy, which is why the same four codes
 * drive both the local checks here and the mapping of a backend rejection.
 * That is deliberate: whichever side rejects first, the regulator sees the
 * identical sentence, and the mgmt-tests journey suite has one stable
 * string per rule to assert on.
 *
 * Two rules are easy to get wrong and are commented at their check:
 * today is VALID, and the lower bound is a flat 12-month floor rather than
 * anything to do with the application's submission date.
 */

export const PAYMENT_DATE_FIELD = 'paymentDate'

/** The GOV.UK date-input component ids, and the error-summary anchor. */
export const PAYMENT_DATE_ID = 'payment-date'
export const PAYMENT_DATE_ANCHOR = `#${PAYMENT_DATE_ID}-day`

export const ERROR_REQUIRED = 'payment-date-required'
export const ERROR_INVALID = 'payment-date-invalid'
export const ERROR_IN_FUTURE = 'payment-date-in-future'
export const ERROR_TOO_OLD = 'payment-date-too-old'

/** How far back a payment date may be, in months. Mirrors the backend. */
export const MAX_AGE_MONTHS = 12

/**
 * User-facing copy, one sentence per rule.
 *
 * The too-old wording says "within the last 12 months" and deliberately
 * does NOT mention the application's submission date: management-be
 * explicitly ACCEPTS a payment dated before the work item existed (a
 * regulator keying a genuine early payment is a real case), and the floor
 * exists only to stop a mistyped year silently creating an already-breached
 * SLA clock. Wording it as a submission-date rule would describe a rule
 * that nobody implemented.
 */
export const PAYMENT_DATE_MESSAGES = {
  [ERROR_REQUIRED]: 'Enter the payment date',
  [ERROR_INVALID]: 'Payment date must be a real date',
  [ERROR_IN_FUTURE]: 'Payment date must be today or in the past',
  [ERROR_TOO_OLD]: `Payment date must be within the last ${MAX_AGE_MONTHS} months`
}

/** Every code this page knows how to bind to the date input. */
export const PAYMENT_DATE_ERROR_CODES = Object.keys(PAYMENT_DATE_MESSAGES)

/**
 * Is this a payment-date rejection (bind it to the field), or something
 * structural like a 409 or a 404 (render it at page level)?
 *
 * Unrecognised codes are NOT treated as field errors — management-be
 * emits only the four above, so anything else means the contract moved and
 * a generic banner is the honest response.
 */
export function isPaymentDateErrorCode(code) {
  return typeof code === 'string' && PAYMENT_DATE_ERROR_CODES.includes(code)
}

export function messageForErrorCode(code) {
  return PAYMENT_DATE_MESSAGES[code] ?? null
}

function textOf(value) {
  return value == null ? '' : String(value).trim()
}

function pad(value, length) {
  return String(value).padStart(length, '0')
}

function startOfUtcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * Validate the three date-input boxes and produce the backend's wire
 * format.
 *
 * @param {{ day?: string, month?: string, year?: string }} values
 * @param {Date} [now] Injected in tests. UTC is used throughout to match
 *   the backend's notion of "today".
 * @returns {{ ok: true, value: string } | { ok: false, errorCode: string }}
 *   `value` is a plain `YYYY-MM-DD` string. The backend parses with an
 *   exact `yyyy-MM-dd` invariant-culture format and REJECTS a full ISO
 *   timestamp, so this must never grow a time component.
 */
export function validatePaymentDate(values, now = new Date()) {
  const day = textOf(values?.day)
  const month = textOf(values?.month)
  const year = textOf(values?.year)

  if (day === '' && month === '' && year === '') {
    return { ok: false, errorCode: ERROR_REQUIRED }
  }

  // A PARTIALLY filled date collapses to `invalid` rather than getting its
  // own "must include a month" message. GDS would normally prefer the
  // per-part wording, but the four codes above are a contract shared with
  // the backend and the e2e suite asserts exactly these four strings;
  // inventing a fifth here would mean a message no backend rejection can
  // ever produce. Revisit only alongside management-be.
  if (
    !/^\d{1,2}$/.test(day) ||
    !/^\d{1,2}$/.test(month) ||
    !/^\d{4}$/.test(year)
  ) {
    return { ok: false, errorCode: ERROR_INVALID }
  }

  const d = Number(day)
  const m = Number(month)
  const y = Number(year)

  const asUtc = new Date(Date.UTC(y, m - 1, d))
  // Round-trip check. `Date.UTC` happily rolls 2026-02-30 forward into
  // March, so comparing the parts back is what actually rejects an unreal
  // date — a range check on d/m alone would let it through.
  if (
    asUtc.getUTCFullYear() !== y ||
    asUtc.getUTCMonth() !== m - 1 ||
    asUtc.getUTCDate() !== d
  ) {
    return { ok: false, errorCode: ERROR_INVALID }
  }

  const today = startOfUtcDay(now)

  // TODAY IS VALID. The comparison is strictly greater-than for exactly
  // that reason — a payment keyed the same day it landed is the common
  // case, and `>=` here would reject it.
  if (asUtc.getTime() > today) {
    return { ok: false, errorCode: ERROR_IN_FUTURE }
  }

  const floor = new Date(today)
  floor.setUTCMonth(floor.getUTCMonth() - MAX_AGE_MONTHS)
  // The floor date itself is allowed, hence `<` rather than `<=`.
  if (asUtc.getTime() < floor.getTime()) {
    return { ok: false, errorCode: ERROR_TOO_OLD }
  }

  return { ok: true, value: `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}` }
}

/**
 * Build a `govukErrorSummary` model for a payment-date failure.
 *
 * The anchor targets the DAY box: GDS links a date-input error to the
 * first field of the group so focus lands somewhere sensible.
 */
export function buildPaymentDateErrorSummary(errorCode) {
  const message = messageForErrorCode(errorCode)
  if (!message) {
    return null
  }
  return {
    titleText: 'There is a problem',
    items: [{ text: message, href: PAYMENT_DATE_ANCHOR }]
  }
}

/**
 * Format an integer minor-unit amount as GBP.
 *
 * `chargeAmountPence` arrives in PENCE — £3,276 is `327600`. Getting this
 * wrong is a silent factor-of-100 error on a financial screen, so the
 * units are asserted in the tests rather than trusted.
 *
 * Whole pounds render without decimals ("£3,276") to match the design;
 * a part-pound amount keeps both ("£3,276.50").
 *
 * @returns {string|null} `null` when the amount is absent or not an
 *   integer — the caller decides how to degrade. Note `0` is a LEGITIMATE
 *   amount and formats as "£0"; it must never be confused with absent.
 */
export function formatChargeAmount(pence) {
  if (typeof pence !== 'number' || !Number.isInteger(pence)) {
    return null
  }
  const hasFraction = pence % 100 !== 0
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0
  }).format(pence / 100)
}

/**
 * Resolve the payment reference to display.
 *
 * ⚠ THERE IS DELIBERATELY NO FALLBACK, AND ONE MUST NOT BE ADDED.
 *
 * `payload.paymentReference` is the only source. When it is absent the
 * page shows "Not provided" — and today that is what almost every work
 * item will show, because legacy-be assigns the reference only after its
 * adapter call fires, so it is structurally absent on initial submission.
 * That mass of "Not provided" is the intended outcome, not a regression
 * to be papered over.
 *
 * The tempting fallback is `applicationReference`, and it is tempting for
 * a real reason: the operator journey renders that same value under a
 * "Payment reference" label, and it is the string the operator is told to
 * quote on the bank transfer. It was in fact used here until this was
 * reversed by an explicit product decision.
 *
 * The reason it is gone: this is a payment RECONCILIATION screen, and a
 * populated-looking field is indistinguishable from a working one. If the
 * upstream feed that supplies `paymentReference` silently breaks, a
 * fallback keeps every page looking correct and nobody finds out; a
 * visible gap surfaces the breakage the first time a regulator opens the
 * page. A gap you can see beats a plausible value that hides a broken
 * feed — the same reasoning that keeps `0` distinguishable from absent
 * for the charge amount.
 *
 * @param {object} [payload] The work item's `payload` object.
 * @returns {string|null} `null` when `paymentReference` is absent or blank.
 */
export function resolvePaymentReference(payload) {
  const explicit = textOf(payload?.paymentReference)
  return explicit === '' ? null : explicit
}
