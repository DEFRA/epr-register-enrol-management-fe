import { vi } from 'vitest'

import { formatDate, formatDateTimeGds } from './format-date.js'

describe('#formatDate', () => {
  beforeAll(() => {
    vi.useFakeTimers({
      now: new Date('2023-02-01')
    })
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  describe('With defaults', () => {
    test('Date should be in expected format', () => {
      expect(formatDate('2023-02-01T11:40:02.242Z')).toBe(
        'Wed 1st February 2023'
      )
    })
  })

  describe('With Date object', () => {
    test('Date should be in expected format', () => {
      expect(formatDate(new Date())).toBe('Wed 1st February 2023')
    })
  })

  describe('With format attribute', () => {
    test('Date should be in provided format', () => {
      expect(
        formatDate(
          '2023-02-01T11:40:02.242Z',
          "h:mm aaa 'on' EEEE do MMMM yyyy"
        )
      ).toBe('11:40 am on Wednesday 1st February 2023')
    })
  })
})

// ---------------------------------------------------------------- //
// formatDateTimeGds tests use January / February / December dates  //
// (UK GMT = UTC+0) so assertions are timezone-stable across both   //
// UTC servers and UK-local (GMT/BST) developer machines.           //
// ---------------------------------------------------------------- //
describe('#formatDateTimeGds', () => {
  test('Formats an ISO-8601 string in GDS date-time format', () => {
    // 15 January 2026 at 10:00am — UK is in GMT (UTC+0) so UTC == local
    expect(formatDateTimeGds('2026-01-15T10:00:00Z')).toBe(
      '15 January 2026 at 10:00am'
    )
  })

  test('Formats a single-digit day without leading zero', () => {
    expect(formatDateTimeGds('2026-02-01T09:05:00Z')).toBe(
      '1 February 2026 at 9:05am'
    )
  })

  test('Uses 12-hour clock with pm for afternoon times', () => {
    expect(formatDateTimeGds('2026-01-15T14:30:00Z')).toBe(
      '15 January 2026 at 2:30pm'
    )
  })

  test('Formats midnight as 12:00am', () => {
    expect(formatDateTimeGds('2026-12-10T00:00:00Z')).toBe(
      '10 December 2026 at 12:00am'
    )
  })

  test('Formats noon as 12:00pm', () => {
    expect(formatDateTimeGds('2026-12-10T12:00:00Z')).toBe(
      '10 December 2026 at 12:00pm'
    )
  })

  test('Accepts a Date object', () => {
    // Pass a pre-constructed Date using a GMT winter date
    expect(formatDateTimeGds(new Date('2026-01-15T08:00:00Z'))).toBe(
      '15 January 2026 at 8:00am'
    )
  })

  test('Returns an empty string for a null value', () => {
    expect(formatDateTimeGds(null)).toBe('')
  })

  test('Returns an empty string for an undefined value', () => {
    expect(formatDateTimeGds(undefined)).toBe('')
  })

  test('Returns an empty string for an unparseable string', () => {
    expect(formatDateTimeGds('not-a-date')).toBe('')
  })
})
