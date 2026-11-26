import { describe, expect, test } from 'vitest'

import {
  ERROR_AFTER_YEAR_END,
  ERROR_BEFORE_YEAR_START,
  ERROR_INVALID,
  ERROR_REQUIRED,
  accreditationYearOf,
  effectiveDateMessage,
  isEffectiveDateErrorCode,
  validateEffectiveDate
} from './effective-date.js'

// RA-495 AC6 / RA-795. The valid from date must fall between 1 January and
// 31 December (inclusive) of the work item's accreditation year.
const YEAR = 2026

const date = (day, month, year) => ({ day, month, year })

describe('validateEffectiveDate (RA-795)', () => {
  test('requires a date', () => {
    expect(validateEffectiveDate(date('', '', ''), YEAR)).toEqual({
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
    expect(validateEffectiveDate(values, YEAR)).toEqual({
      ok: false,
      errorCode: ERROR_INVALID
    })
  })

  test.each([
    ['the day before 1 January', date('31', '12', '2025')],
    ['a date in a much earlier year', date('1', '1', '2000')]
  ])('rejects %s as before the year starts', (_, values) => {
    expect(validateEffectiveDate(values, YEAR)).toEqual({
      ok: false,
      errorCode: ERROR_BEFORE_YEAR_START
    })
  })

  test.each([
    ['the day after 31 December', date('1', '1', '2027')],
    ['a date in a much later year', date('1', '1', '2099')]
  ])('rejects %s as after the year ends', (_, values) => {
    expect(validateEffectiveDate(values, YEAR)).toEqual({
      ok: false,
      errorCode: ERROR_AFTER_YEAR_END
    })
  })

  test.each([
    ['1 January', date('1', '1', '2026'), '2026-01-01'],
    ['31 December', date('31', '12', '2026'), '2026-12-31'],
    ['a date mid-year', date('16', '6', '2026'), '2026-06-16']
  ])('accepts %s', (_, values, value) => {
    expect(validateEffectiveDate(values, YEAR)).toEqual({ ok: true, value })
  })

  test('leaves the bounds to management-be when the year is unreadable', () => {
    for (const unreadable of [undefined, null, 'abc', 26, 20260]) {
      expect(validateEffectiveDate(date('1', '1', '2000'), unreadable)).toEqual(
        { ok: true, value: '2000-01-01' }
      )
    }
  })
})

describe('accreditationYearOf', () => {
  test('reads the year the work item was submitted with', () => {
    expect(accreditationYearOf({ payload: { accreditationYear: 2026 } })).toBe(
      2026
    )
  })

  test.each([
    ['a missing payload', {}],
    ['no year', { payload: {} }],
    ['a string year', { payload: { accreditationYear: '2026' } }],
    ['a non 4-digit year', { payload: { accreditationYear: 26 } }]
  ])('is null for %s', (_, workItem) => {
    expect(accreditationYearOf(workItem)).toBeNull()
  })
})

describe('effective-date error codes', () => {
  test('binds only its own codes, each with a sentence', () => {
    for (const code of [
      ERROR_REQUIRED,
      ERROR_INVALID,
      ERROR_BEFORE_YEAR_START,
      ERROR_AFTER_YEAR_END
    ]) {
      expect(isEffectiveDateErrorCode(code)).toBe(true)
      expect(effectiveDateMessage(code, YEAR)).toEqual(expect.any(String))
    }
    expect(isEffectiveDateErrorCode('payment-date-required')).toBe(false)
    expect(isEffectiveDateErrorCode(undefined)).toBe(false)
  })

  test('the range messages name the year', () => {
    expect(effectiveDateMessage(ERROR_BEFORE_YEAR_START, 2026)).toBe(
      'Valid from date must be on or after 1 January 2026'
    )
    expect(effectiveDateMessage(ERROR_AFTER_YEAR_END, 2031)).toBe(
      'Valid from date must be on or before 31 December 2031'
    )
  })

  test('a range message has no sentence without a year', () => {
    expect(effectiveDateMessage(ERROR_BEFORE_YEAR_START, null)).toBeNull()
    expect(effectiveDateMessage(ERROR_AFTER_YEAR_END, undefined)).toBeNull()
  })
})
