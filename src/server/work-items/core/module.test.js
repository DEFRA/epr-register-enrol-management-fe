import { describe, test, expect } from 'vitest'

import { assertValidWorkItemModule } from './module.js'

const validType = (overrides = {}) => ({
  id: 'sample',
  displayName: 'Sample',
  templateVersion: 'v1',
  initialState: 'draft',
  states: [
    { id: 'draft', displayName: 'Draft' },
    { id: 'done', displayName: 'Done', isTerminal: true }
  ],
  transitions: [
    {
      actionId: 'finish',
      displayName: 'Finish',
      fromStateId: 'draft',
      toStateId: 'done'
    }
  ],
  getTasksForState: () => [],
  ...overrides
})

const validModule = (overrides = {}) => ({
  type: validType(overrides.type),
  register: async () => {},
  ...('register' in overrides ? { register: overrides.register } : {})
})

describe('assertValidWorkItemModule', () => {
  test('accepts a well-formed module', () => {
    expect(() => assertValidWorkItemModule(validModule())).not.toThrow()
  })

  test('accepts an `initialState` declared as a state object', () => {
    const states = [
      { id: 'draft', displayName: 'Draft' },
      { id: 'done', displayName: 'Done', isTerminal: true }
    ]
    expect(() =>
      assertValidWorkItemModule(
        validModule({ type: { initialState: states[0], states } })
      )
    ).not.toThrow()
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
      assertValidWorkItemModule({
        type: { id: '   ' },
        register: async () => {}
      })
    ).toThrow(/non-empty string id/)
  })

  test('rejects a module without a register function', () => {
    expect(() =>
      assertValidWorkItemModule({ ...validModule(), register: undefined })
    ).toThrow(/async `register\(server\)` function/)
  })

  test('rejects a missing `templateVersion`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({ type: { templateVersion: undefined } })
      )
    ).toThrow(/non-empty string `templateVersion`/)
  })

  test('rejects a blank `templateVersion`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({ type: { templateVersion: '  ' } })
      )
    ).toThrow(/non-empty string `templateVersion`/)
  })

  test('rejects a missing `states` array', () => {
    expect(() =>
      assertValidWorkItemModule(validModule({ type: { states: undefined } }))
    ).toThrow(/non-empty `states` array/)
  })

  test('rejects an empty `states` array', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: { states: [], initialState: 'draft', transitions: [] }
        })
      )
    ).toThrow(/non-empty `states` array/)
  })

  test('rejects a state with a missing id', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            states: [{ displayName: 'No id' }],
            initialState: 'draft',
            transitions: []
          }
        })
      )
    ).toThrow(/state with a missing or non-string `id`/)
  })

  test('rejects a state with a blank id', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            states: [{ id: '   ', displayName: 'Blank' }],
            initialState: 'draft',
            transitions: []
          }
        })
      )
    ).toThrow(/state with a missing or non-string `id`/)
  })

  test('rejects duplicate state ids', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            states: [
              { id: 'draft', displayName: 'Draft' },
              { id: 'draft', displayName: 'Draft again' }
            ],
            initialState: 'draft',
            transitions: []
          }
        })
      )
    ).toThrow(/duplicate state id "draft"/)
  })

  test('rejects a missing `initialState`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({ type: { initialState: undefined } })
      )
    ).toThrow(/must declare a non-empty `initialState`/)
  })

  test('rejects a blank `initialState`', () => {
    expect(() =>
      assertValidWorkItemModule(validModule({ type: { initialState: '   ' } }))
    ).toThrow(/must declare a non-empty `initialState`/)
  })

  test('rejects an `initialState` not present in `states`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({ type: { initialState: 'nowhere' } })
      )
    ).toThrow(/`initialState` "nowhere" is not present in `states`/)
  })

  test('rejects a missing `transitions` array', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({ type: { transitions: undefined } })
      )
    ).toThrow(/must declare a `transitions` array/)
  })

  test('accepts an empty `transitions` array', () => {
    expect(() =>
      assertValidWorkItemModule(validModule({ type: { transitions: [] } }))
    ).not.toThrow()
  })

  test('rejects a non-object transition', () => {
    expect(() =>
      assertValidWorkItemModule(validModule({ type: { transitions: [null] } }))
    ).toThrow(/transition that is not an object/)
  })

  test('rejects a transition with a missing `actionId`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            transitions: [{ fromStateId: 'draft', toStateId: 'done' }]
          }
        })
      )
    ).toThrow(/missing or non-string `actionId`/)
  })

  test('rejects a transition with a blank `fromStateId`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            transitions: [
              { actionId: 'finish', fromStateId: '   ', toStateId: 'done' }
            ]
          }
        })
      )
    ).toThrow(/non-empty `fromStateId`/)
  })

  test('rejects a transition with a missing `toStateId`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            transitions: [{ actionId: 'finish', fromStateId: 'draft' }]
          }
        })
      )
    ).toThrow(/non-empty `toStateId`/)
  })

  test('rejects a transition referencing an unknown `fromStateId`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            transitions: [
              { actionId: 'finish', fromStateId: 'nowhere', toStateId: 'done' }
            ]
          }
        })
      )
    ).toThrow(/unknown `fromStateId` "nowhere"/)
  })

  test('rejects a transition referencing an unknown `toStateId`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            transitions: [
              {
                actionId: 'finish',
                fromStateId: 'draft',
                toStateId: 'nowhere'
              }
            ]
          }
        })
      )
    ).toThrow(/unknown `toStateId` "nowhere"/)
  })

  test('rejects duplicate transition `actionId`s', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            transitions: [
              {
                actionId: 'finish',
                fromStateId: 'draft',
                toStateId: 'done'
              },
              {
                actionId: 'finish',
                fromStateId: 'done',
                toStateId: 'draft'
              }
            ]
          }
        })
      )
    ).toThrow(/duplicate transition `actionId` "finish"/)
  })

  test('rejects a missing `getTasksForState` function', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({ type: { getTasksForState: undefined } })
      )
    ).toThrow(/must declare a `getTasksForState` function/)
  })

  test('rejects a non-function `getTasksForState`', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({ type: { getTasksForState: 'nope' } })
      )
    ).toThrow(/must declare a `getTasksForState` function/)
  })
})
