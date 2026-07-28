import { describe, expect, test } from 'vitest'

import { unwrapMongoDate } from './mongo-date.js'

describe('#unwrapMongoDate', () => {
  test('returns a plain ISO string unchanged', () => {
    expect(unwrapMongoDate('2026-03-26T09:00:00Z')).toBe('2026-03-26T09:00:00Z')
  })

  test('unwraps the Mongo extended-JSON { $date } shape', () => {
    expect(unwrapMongoDate({ $date: '2026-03-26T09:00:00Z' })).toBe(
      '2026-03-26T09:00:00Z'
    )
  })

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['zero', 0],
    ['false', false]
  ])('returns null for %s', (_label, value) => {
    expect(unwrapMongoDate(value)).toBeNull()
  })

  test('returns null for an object without a string $date', () => {
    expect(unwrapMongoDate({ $date: 1234 })).toBeNull()
    expect(unwrapMongoDate({ nope: 'x' })).toBeNull()
  })

  test('returns null for a non-string, non-object truthy value', () => {
    expect(unwrapMongoDate(42)).toBeNull()
  })
})
