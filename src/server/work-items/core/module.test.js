import { describe, test, expect } from 'vitest'

import { assertValidWorkItemModule } from './module.js'

const validModule = (overrides = {}) => ({
  type: { id: 'sample', displayName: 'Sample' },
  register: async () => {},
  ...overrides
})

describe('assertValidWorkItemModule', () => {
  test('accepts a well-formed module', () => {
    expect(() => assertValidWorkItemModule(validModule())).not.toThrow()
  })

  test('rejects a missing module', () => {
    expect(() => assertValidWorkItemModule(undefined)).toThrow(
      /must be an object/
    )
    expect(() => assertValidWorkItemModule(null)).toThrow(/must be an object/)
  })

  test('rejects a module without a type', () => {
    expect(() =>
      assertValidWorkItemModule({ register: async () => {} })
    ).toThrow(/non-empty string id/)
  })

  test('rejects a module with a blank type id', () => {
    expect(() =>
      assertValidWorkItemModule(validModule({ type: { id: '   ' } }))
    ).toThrow(/non-empty string id/)
  })

  test('rejects a module without a register function', () => {
    expect(() =>
      assertValidWorkItemModule(validModule({ register: undefined }))
    ).toThrow(/async `register\(server\)` function/)
  })
})
