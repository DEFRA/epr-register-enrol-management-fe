import { describe, expect, test } from 'vitest'

import { formatChargeAmount } from './charge-amount.js'

describe('formatChargeAmount', () => {
  test('formats pence as GBP with a thousands separator', () => {
    // £3,276 arrives as 327600. A factor-of-100 slip here is silent and
    // financial, so the exact figure from the design is pinned.
    expect(formatChargeAmount(327600)).toBe('£3,276')
  })

  /**
   * The pounds/pence boundary is the single most likely place this
   * contract breaks, because it fails silently and PLAUSIBLY: "£54,600"
   * and "£546" are both believable renderings of the same integer, and
   * nothing throws either way. These are management-be's actual seeded
   * values, following the operator backend's real fee bands (£546 /
   * £2,184 / £3,276 / £3,965, plus £328 per overseas reprocessing site),
   * so a factor-of-100 slip fails here rather than in a compose run.
   */
  test.each([
    [54600, '£546'],
    [218400, '£2,184'],
    [327600, '£3,276'],
    [396500, '£3,965'],
    [360400, '£3,604']
  ])('formats the seeded amount %i as %s', (pence, expected) => {
    expect(formatChargeAmount(pence)).toBe(expected)
  })

  test('does not confuse pence with pounds', () => {
    // The failure mode: rendering the raw integer as pounds.
    expect(formatChargeAmount(54600)).not.toBe('£54,600')
    expect(formatChargeAmount(327600)).not.toBe('£327,600')
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
