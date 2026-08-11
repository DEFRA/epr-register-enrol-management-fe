import { describe, expect, test } from 'vitest'

import {
  ERROR_INVALID,
  ERROR_IN_FUTURE,
  ERROR_REQUIRED,
  ERROR_TOO_OLD,
  PAYMENT_DATE_ANCHOR,
  PAYMENT_DATE_MESSAGES,
  buildPaymentDateErrorSummary,
  formatChargeAmount,
  isPaymentDateErrorCode,
  resolvePaymentReference,
  validatePaymentDate
} from './payment-date.js'

/**
 * RA-316. The four error codes are a contract shared with management-be,
 * and two of the rules are counter-intuitive enough to be worth pinning:
 * today is VALID, and the lower bound is a flat 12-month floor rather than
 * anything to do with the application's submission date.
 */

// A fixed "now" so the boundary tests are not time-of-run dependent.
const NOW = new Date('2026-08-11T09:30:00Z')

function parts(day, month, year) {
  return { day: String(day), month: String(month), year: String(year) }
}

describe('validatePaymentDate', () => {
  test('accepts a valid past date and emits plain YYYY-MM-DD', () => {
    const result = validatePaymentDate(parts(27, 3, 2026), NOW)
    expect(result).toEqual({ ok: true, value: '2026-03-27' })
  })

  test('zero-pads day and month', () => {
    expect(validatePaymentDate(parts(5, 4, 2026), NOW).value).toBe('2026-04-05')
  })

  test('never emits a time component (the backend rejects ISO timestamps)', () => {
    const { value } = validatePaymentDate(parts(1, 1, 2026), NOW)
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(value).not.toContain('T')
  })

  test('all three boxes empty is "required", not "invalid"', () => {
    expect(validatePaymentDate({ day: '', month: '', year: '' }, NOW)).toEqual({
      ok: false,
      errorCode: ERROR_REQUIRED
    })
  })

  test('a missing payload object is treated as empty', () => {
    expect(validatePaymentDate(undefined, NOW).errorCode).toBe(ERROR_REQUIRED)
    expect(validatePaymentDate({}, NOW).errorCode).toBe(ERROR_REQUIRED)
  })

  test('whitespace-only boxes count as empty', () => {
    expect(validatePaymentDate(parts(' ', ' ', ' '), NOW).errorCode).toBe(
      ERROR_REQUIRED
    )
  })

  test.each([
    ['partial — day only', { day: '1', month: '', year: '' }],
    ['partial — no year', { day: '1', month: '2', year: '' }],
    ['non-numeric day', { day: 'x', month: '2', year: '2026' }],
    ['two-digit year', { day: '1', month: '2', year: '26' }],
    ['month 13', { day: '1', month: '13', year: '2026' }],
    ['month 0', { day: '1', month: '0', year: '2026' }],
    ['day 0', { day: '0', month: '2', year: '2026' }],
    ['day 32', { day: '32', month: '1', year: '2026' }]
  ])('rejects %s as invalid', (_label, values) => {
    expect(validatePaymentDate(values, NOW)).toEqual({
      ok: false,
      errorCode: ERROR_INVALID
    })
  })

  test('rejects 30 February rather than rolling it into March', () => {
    // The round-trip check exists for exactly this: Date.UTC would
    // silently produce 2026-03-02.
    expect(validatePaymentDate(parts(30, 2, 2026), NOW).errorCode).toBe(
      ERROR_INVALID
    )
  })

  test('accepts 29 February in a leap year', () => {
    expect(
      validatePaymentDate(parts(29, 2, 2024), new Date('2024-06-01T00:00:00Z'))
    ).toEqual({ ok: true, value: '2024-02-29' })
  })

  test('rejects 29 February in a non-leap year', () => {
    expect(validatePaymentDate(parts(29, 2, 2026), NOW).errorCode).toBe(
      ERROR_INVALID
    )
  })

  // ---- the boundary that is easiest to get wrong ----

  test('TODAY is accepted', () => {
    expect(validatePaymentDate(parts(11, 8, 2026), NOW)).toEqual({
      ok: true,
      value: '2026-08-11'
    })
  })

  test('today is accepted even when "now" is late in the day', () => {
    // Guards against comparing against the current instant rather than the
    // start of the UTC day.
    expect(
      validatePaymentDate(parts(11, 8, 2026), new Date('2026-08-11T23:59:59Z'))
        .ok
    ).toBe(true)
  })

  test('TOMORROW is rejected as in-future', () => {
    expect(validatePaymentDate(parts(12, 8, 2026), NOW)).toEqual({
      ok: false,
      errorCode: ERROR_IN_FUTURE
    })
  })

  test('exactly 12 months ago is accepted (the floor itself is valid)', () => {
    expect(validatePaymentDate(parts(11, 8, 2025), NOW)).toEqual({
      ok: true,
      value: '2025-08-11'
    })
  })

  test('one day before the 12-month floor is rejected as too old', () => {
    expect(validatePaymentDate(parts(10, 8, 2025), NOW)).toEqual({
      ok: false,
      errorCode: ERROR_TOO_OLD
    })
  })

  test('a mistyped year is caught by the floor', () => {
    expect(validatePaymentDate(parts(11, 8, 2016), NOW).errorCode).toBe(
      ERROR_TOO_OLD
    )
  })
})

describe('error messages', () => {
  test('the too-old message says 12 months and does NOT mention submission', () => {
    // management-be deliberately ACCEPTS a payment date earlier than the
    // application's submission date, so wording this as a submission rule
    // would describe a rule nobody implemented.
    const message = PAYMENT_DATE_MESSAGES[ERROR_TOO_OLD]
    expect(message).toBe('Payment date must be within the last 12 months')
    expect(message.toLowerCase()).not.toContain('submit')
  })

  test('the future message allows today', () => {
    expect(PAYMENT_DATE_MESSAGES[ERROR_IN_FUTURE]).toBe(
      'Payment date must be today or in the past'
    )
  })

  test('builds an error summary anchored to the day box', () => {
    const summary = buildPaymentDateErrorSummary(ERROR_IN_FUTURE)
    expect(summary.titleText).toBe('There is a problem')
    expect(summary.items).toEqual([
      {
        text: 'Payment date must be today or in the past',
        href: PAYMENT_DATE_ANCHOR
      }
    ])
    expect(PAYMENT_DATE_ANCHOR).toBe('#payment-date-day')
  })

  test('no summary for an unknown or absent code', () => {
    expect(buildPaymentDateErrorSummary('something-else')).toBeNull()
    expect(buildPaymentDateErrorSummary(null)).toBeNull()
  })

  test('only the four known codes bind to the field', () => {
    for (const code of [
      ERROR_REQUIRED,
      ERROR_INVALID,
      ERROR_IN_FUTURE,
      ERROR_TOO_OLD
    ]) {
      expect(isPaymentDateErrorCode(code)).toBe(true)
    }
    // A structural failure must NOT be rendered against the date input.
    expect(isPaymentDateErrorCode('wrong-work-item-type')).toBe(false)
    expect(isPaymentDateErrorCode(null)).toBe(false)
    expect(isPaymentDateErrorCode(undefined)).toBe(false)
  })
})

describe('formatChargeAmount', () => {
  test('formats pence as GBP with a thousands separator', () => {
    // £3,276 arrives as 327600. A factor-of-100 slip here is silent and
    // financial, so the exact figure from the design is pinned.
    expect(formatChargeAmount(327600)).toBe('£3,276')
  })

  test('keeps pence when the amount is not whole pounds', () => {
    expect(formatChargeAmount(327650)).toBe('£3,276.50')
    expect(formatChargeAmount(1)).toBe('£0.01')
  })

  test('zero is a legitimate amount, not a missing one', () => {
    expect(formatChargeAmount(0)).toBe('£0')
  })

  test('returns null when the field is absent or not an integer', () => {
    expect(formatChargeAmount(undefined)).toBeNull()
    expect(formatChargeAmount(null)).toBeNull()
    expect(formatChargeAmount('327600')).toBeNull()
    expect(formatChargeAmount(3276.5)).toBeNull()
    expect(formatChargeAmount(Number.NaN)).toBeNull()
  })
})

describe('resolvePaymentReference', () => {
  test('prefers an explicit paymentReference', () => {
    expect(
      resolvePaymentReference({
        paymentReference: 'A27ER1230040001GR',
        applicationReference: 'RA-2026-00004'
      })
    ).toBe('A27ER1230040001GR')
  })

  test('falls back to applicationReference when absent', () => {
    // In this system the application reference IS the payment reference:
    // the operator is instructed to quote it on the bank transfer.
    expect(
      resolvePaymentReference({ applicationReference: 'RA-2026-00004' })
    ).toBe('RA-2026-00004')
  })

  test('falls back when paymentReference is empty or whitespace', () => {
    expect(
      resolvePaymentReference({
        paymentReference: '   ',
        applicationReference: 'RA-2026-00004'
      })
    ).toBe('RA-2026-00004')
  })

  test('returns null only when neither exists', () => {
    expect(resolvePaymentReference({})).toBeNull()
    expect(resolvePaymentReference(undefined)).toBeNull()
  })
})
