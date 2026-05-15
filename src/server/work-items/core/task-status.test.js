import { describe, it, expect } from 'vitest'
import { isTaskComplete } from './task-status.js'

describe('isTaskComplete (RA-129 review point 4)', () => {
  it('returns false for null / undefined', () => {
    expect(isTaskComplete(null)).toBe(false)
    expect(isTaskComplete(undefined)).toBe(false)
  })

  it("returns true when status is 'Completed'", () => {
    expect(isTaskComplete({ status: 'Completed' })).toBe(true)
  })

  it('falls back to legacy isComplete=true when status is absent', () => {
    expect(isTaskComplete({ isComplete: true })).toBe(true)
    expect(isTaskComplete({ status: null, isComplete: true })).toBe(true)
  })

  it('does not treat legacy isComplete=true as completing a non-completed status', () => {
    expect(isTaskComplete({ status: 'InProgress', isComplete: true })).toBe(
      false
    )
  })

  it('returns false for any other status', () => {
    expect(isTaskComplete({ status: 'NotStarted' })).toBe(false)
    expect(isTaskComplete({ status: 'Blocked' })).toBe(false)
    expect(isTaskComplete({})).toBe(false)
  })
})
