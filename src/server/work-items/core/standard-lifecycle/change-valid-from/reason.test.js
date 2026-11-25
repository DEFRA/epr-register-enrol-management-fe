import { describe, expect, test } from 'vitest'

import {
  ERROR_REASON_REQUIRED,
  ERROR_REASON_TOO_LONG,
  MAX_REASON_WORDS,
  countWords,
  isReasonErrorCode,
  messageForReasonErrorCode,
  validateReason
} from './reason.js'

const words = (n) => Array.from({ length: n }, () => 'word').join(' ')

describe('validateReason', () => {
  test('accepts a reason, trimmed with CRLF normalised', () => {
    expect(validateReason('  Typo.\r\nSee email.  ')).toEqual({
      ok: true,
      value: 'Typo.\nSee email.'
    })
  })

  test.each([undefined, null, '', '   ', '\r\n'])(
    'requires a reason (%j)',
    (text) => {
      expect(validateReason(text)).toEqual({
        ok: false,
        errorCode: ERROR_REASON_REQUIRED
      })
    }
  )

  test('accepts exactly 200 words and rejects 201', () => {
    expect(validateReason(words(MAX_REASON_WORDS)).ok).toBe(true)
    expect(validateReason(words(MAX_REASON_WORDS + 1))).toEqual({
      ok: false,
      errorCode: ERROR_REASON_TOO_LONG
    })
  })

  test('counts whitespace-separated words across lines', () => {
    expect(countWords('one\ntwo  three\tfour')).toBe(4)
    expect(countWords('')).toBe(0)
  })
})

describe('reason error codes (shared contract with management-be)', () => {
  test('uses the effective-date-reason-* codes', () => {
    expect(ERROR_REASON_REQUIRED).toBe('effective-date-reason-required')
    expect(ERROR_REASON_TOO_LONG).toBe('effective-date-reason-too-long')
  })

  test('recognises and words its own codes only', () => {
    expect(isReasonErrorCode(ERROR_REASON_REQUIRED)).toBe(true)
    expect(isReasonErrorCode('effective-date-required')).toBe(false)
    expect(isReasonErrorCode('payment-date-reason-required')).toBe(false)
    expect(messageForReasonErrorCode(ERROR_REASON_REQUIRED)).toBe(
      'Enter a reason for the valid from date change'
    )
    expect(messageForReasonErrorCode(ERROR_REASON_TOO_LONG)).toBe(
      'Reason must be 200 words or fewer'
    )
    expect(messageForReasonErrorCode('nope')).toBeNull()
  })
})
