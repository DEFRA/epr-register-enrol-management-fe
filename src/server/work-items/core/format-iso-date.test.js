import { describe, expect, test } from 'vitest'

import { formatIsoDate } from './format-iso-date.js'

describe('formatIsoDate', () => {
  test('writes a plain YYYY-MM-DD date as dd/mm/yyyy', () => {
    expect(formatIsoDate('2026-03-07')).toBe('07/03/2026')
  })

  test.each([
    undefined,
    null,
    '',
    '07/03/2026',
    '2026-3-7',
    '2026-03-07T00:00:00Z'
  ])('yields null for %s', (value) => {
    expect(formatIsoDate(value)).toBeNull()
  })
})
