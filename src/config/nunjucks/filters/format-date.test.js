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

  describe('With a BST (summer) instant', () => {
    test('Converts to UK local time, rolling over the date', () => {
      // 23:30 UTC on 15 July is 00:30 BST (UTC+1) the next day.
      expect(formatDate('2026-07-15T23:30:00Z', 'd MMMM yyyy')).toBe(
        '16 July 2026'
      )
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

  // ---------------------------------------------------------------- //
  // BST (British Summer Time) conversion. The backend is UTC; these   //
  // assert the explicit Europe/London conversion so they hold even    //
  // when the test runner (and prod) is TZ=UTC.                        //
  // ---------------------------------------------------------------- //
  describe('BST (summer) conversion', () => {
    test('Adds the UTC+1 offset for a summer morning', () => {
      expect(formatDateTimeGds('2026-04-27T10:00:00Z')).toBe(
        '27 April 2026 at 11:00am'
      )
    })

    test('Adds the UTC+1 offset for a summer afternoon', () => {
      expect(formatDateTimeGds('2026-07-15T13:30:00Z')).toBe(
        '15 July 2026 at 2:30pm'
      )
    })
  })

  describe('Spring-forward DST boundary (29 March 2026, clocks go to 02:00)', () => {
    test('Before the jump the time is still GMT', () => {
      expect(formatDateTimeGds('2026-03-29T00:30:00Z')).toBe(
        '29 March 2026 at 12:30am'
      )
    })

    test('After the jump the wall-clock skips the 01:xx hour into BST', () => {
      expect(formatDateTimeGds('2026-03-29T01:30:00Z')).toBe(
        '29 March 2026 at 2:30am'
      )
    })
  })

  describe('Autumn-back DST boundary (25 October 2026, clocks go to 01:00)', () => {
    test('The first pass of 01:30 wall-clock is BST', () => {
      expect(formatDateTimeGds('2026-10-25T00:30:00Z')).toBe(
        '25 October 2026 at 1:30am'
      )
    })

    test('The repeated 01:30 wall-clock is GMT — same wall-clock string', () => {
      expect(formatDateTimeGds('2026-10-25T01:30:00Z')).toBe(
        '25 October 2026 at 1:30am'
      )
    })
  })
})
