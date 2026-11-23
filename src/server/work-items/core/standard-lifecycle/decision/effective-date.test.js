import { describe, expect, test } from 'vitest'

import {
  ERROR_BEFORE_SUBMISSION,
  ERROR_INVALID,
  ERROR_REQUIRED,
  effectiveDateMessage,
  isEffectiveDateErrorCode,
  validateEffectiveDate
} from './effective-date.js'

// RA-495 AC6. Submitted 23:30Z on 15 June 2026: 00:30 on 16 June in London
// (BST), so the UK submission date, and the floor, is 16 June.
const SUBMITTED_AT = '2026-06-15T23:30:00Z'

const date = (day, month, year) => ({ day, month, year })

describe('validateEffectiveDate (RA-495 AC6)', () => {
  test('requires a date', () => {
    expect(validateEffectiveDate(date('', '', ''), SUBMITTED_AT)).toEqual({
      ok: false,
      errorCode: ERROR_REQUIRED
    })
  })

  test.each([
    ['a partial date', date('16', '', '2026')],
    ['an unreal date', date('31', '6', '2026')],
    ['a two-digit year', date('16', '6', '26')],
    ['letters', date('a', 'b', 'cccc')]
  ])('rejects %s as invalid', (_, values) => {
    expect(validateEffectiveDate(values, SUBMITTED_AT)).toEqual({
      ok: false,
      errorCode: ERROR_INVALID
    })
  })

  test('rejects a date before the UK submission date', () => {
    expect(
      validateEffectiveDate(date('15', '6', '2026'), SUBMITTED_AT)
    ).toEqual({ ok: false, errorCode: ERROR_BEFORE_SUBMISSION })
  })

  test('accepts the UK submission date itself', () => {
    expect(
      validateEffectiveDate(date('16', '6', '2026'), SUBMITTED_AT)
    ).toEqual({ ok: true, value: '2026-06-16' })
  })

  test('accepts a future date', () => {
    expect(validateEffectiveDate(date('1', '1', '2099'), SUBMITTED_AT)).toEqual(
      { ok: true, value: '2099-01-01' }
    )
  })

  test('leaves the floor to management-be when the submission date is missing', () => {
    expect(validateEffectiveDate(date('1', '1', '2000'), null)).toEqual({
      ok: true,
      value: '2000-01-01'
    })
  })
})

describe('effective-date error codes', () => {
  test('binds only its own three codes, each with a sentence', () => {
    for (const code of [
      ERROR_REQUIRED,
      ERROR_INVALID,
      ERROR_BEFORE_SUBMISSION
    ]) {
      expect(isEffectiveDateErrorCode(code)).toBe(true)
      expect(effectiveDateMessage(code)).toEqual(expect.any(String))
    }
    expect(isEffectiveDateErrorCode('payment-date-required')).toBe(false)
    expect(isEffectiveDateErrorCode(undefined)).toBe(false)
  })
})
