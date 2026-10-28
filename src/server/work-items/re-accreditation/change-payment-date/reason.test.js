import { describe, expect, test } from 'vitest'

import {
  ERROR_REASON_REQUIRED,
  ERROR_REASON_TOO_LONG,
  countWords,
  isReasonErrorCode,
  messageForReasonErrorCode,
  validateReason
} from './reason.js'

const words = (n) => Array.from({ length: n }, () => 'word').join(' ')

describe('validateReason', () => {
  test('accepts a reason and trims it, normalising CRLF', () => {
    expect(validateReason('  Wrong date.\r\nSee email.  ')).toEqual({
      ok: true,
      value: 'Wrong date.\nSee email.'
    })
  })

  test.each([undefined, null, '', '   ', '\r\n'])(
    'requires a reason (%s)',
    (text) => {
      expect(validateReason(text)).toEqual({
        ok: false,
        errorCode: ERROR_REASON_REQUIRED
      })
    }
  )

  test('allows exactly 200 words and rejects 201', () => {
    expect(validateReason(words(200)).ok).toBe(true)
    expect(validateReason(words(201))).toEqual({
      ok: false,
      errorCode: ERROR_REASON_TOO_LONG
    })
  })

  test('counts words across newlines and repeated whitespace', () => {
    expect(countWords('a  b\n\nc\t d')).toBe(4)
    expect(countWords('')).toBe(0)
  })
})

describe('reason error codes', () => {
  test('recognises only the two backend codes', () => {
    expect(isReasonErrorCode(ERROR_REASON_REQUIRED)).toBe(true)
    expect(isReasonErrorCode(ERROR_REASON_TOO_LONG)).toBe(true)
    expect(isReasonErrorCode('payment-date-required')).toBe(false)
    expect(isReasonErrorCode(undefined)).toBe(false)
  })

  test('has copy for each', () => {
    expect(messageForReasonErrorCode(ERROR_REASON_REQUIRED)).toBe(
      'Enter a reason for the payment date change'
    )
    expect(messageForReasonErrorCode(ERROR_REASON_TOO_LONG)).toBe(
      'Reason must be 200 words or fewer'
    )
    expect(messageForReasonErrorCode('nope')).toBeNull()
  })
})
