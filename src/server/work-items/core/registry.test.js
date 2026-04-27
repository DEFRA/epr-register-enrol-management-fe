import { describe, test, expect, beforeEach } from 'vitest'

import {
  registerWorkItemType,
  getWorkItemType,
  getWorkItemTypes,
  clearWorkItemRegistry
} from './registry.js'

const sampleType = (overrides = {}) => ({
  id: 'sample',
  displayName: 'Sample',
  initialState: { id: 'submitted', displayName: 'Submitted' },
  states: [{ id: 'submitted', displayName: 'Submitted' }],
  getTasksForState: () => [],
  ...overrides
})

describe('work item registry', () => {
  beforeEach(() => clearWorkItemRegistry())

  test('registers and retrieves a type by id', () => {
    const type = sampleType()
    registerWorkItemType(type)

    expect(getWorkItemType('sample')).toBe(type)
  })

  test('returns null when looking up an unknown type', () => {
    expect(getWorkItemType('missing')).toBeNull()
  })

  test('lists every registered type', () => {
    const a = sampleType({ id: 'a', displayName: 'A' })
    const b = sampleType({ id: 'b', displayName: 'B' })
    registerWorkItemType(a)
    registerWorkItemType(b)

    expect(getWorkItemTypes()).toEqual([a, b])
  })

  test('rejects a type without an id', () => {
    expect(() => registerWorkItemType({ displayName: 'No id' })).toThrow(
      /non-empty string id/
    )
  })

  test('rejects a type whose id is blank', () => {
    expect(() => registerWorkItemType(sampleType({ id: '   ' }))).toThrow(
      /non-empty string id/
    )
  })

  test('rejects a duplicate id', () => {
    registerWorkItemType(sampleType())
    expect(() => registerWorkItemType(sampleType())).toThrow(/already registered/)
  })

  test('clearWorkItemRegistry removes every type', () => {
    registerWorkItemType(sampleType())
    clearWorkItemRegistry()
    expect(getWorkItemTypes()).toEqual([])
  })
})
