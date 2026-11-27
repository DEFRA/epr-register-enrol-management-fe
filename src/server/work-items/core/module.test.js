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

  // RA-495. A type opting into the shared Standard-lifecycle pages must say
  // where its payment details live; a missing hook would render "Not
  // provided" on every Duly make page with nothing logged.
  test('accepts a Standard-lifecycle opt-in with its payment details', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            standardLifecycle: { readPaymentDetails: () => ({}) }
          }
        })
      )
    ).not.toThrow()
  })

  test.each([
    ['no payment details', {}],
    ['a non-function payment details hook', { readPaymentDetails: 'payload' }],
    ['a payment date and no payment details', { paymentDate: true }],
    [
      'no payment date and a non-function payment details hook',
      { paymentDate: false, readPaymentDetails: 'payload' }
    ]
  ])('rejects a Standard-lifecycle opt-in with %s', (_, standardLifecycle) => {
    expect(() =>
      assertValidWorkItemModule(validModule({ type: { standardLifecycle } }))
    ).toThrow(/`standardLifecycle.readPaymentDetails` must be a function/)
  })

  test('rejects a Standard-lifecycle backend call that is not a function', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            standardLifecycle: {
              readPaymentDetails: () => ({}),
              backend: { dulyMake: 'POST /duly-make' }
            }
          }
        })
      )
    ).toThrow(/`standardLifecycle.backend.dulyMake` must be a function/)
  })

  test('accepts Standard-lifecycle success banners for either outcome', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            standardLifecycle: {
              readPaymentDetails: () => ({}),
              contactConfirmedBanners: {
                approved: { title: 'Done', text: 'It is done.' }
              }
            }
          }
        })
      )
    ).not.toThrow()
  })

  test.each([
    ['a string', 'Applicant contacted'],
    ['no text', { title: 'Applicant contacted' }],
    ['null', null]
  ])('rejects a Standard-lifecycle success banner that is %s', (_, banner) => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            standardLifecycle: {
              readPaymentDetails: () => ({}),
              contactConfirmedBanners: { rejected: banner }
            }
          }
        })
      )
    ).toThrow(
      /`standardLifecycle.contactConfirmedBanners.rejected` must have a string title and text/
    )
  })

  // RA-782. An uncharged type opts out of the Duly make payment date.
  test.each([true, false])(
    'accepts a Standard-lifecycle paymentDate of %s',
    (paymentDate) => {
      expect(() =>
        assertValidWorkItemModule(
          validModule({
            type: {
              standardLifecycle: { readPaymentDetails: () => ({}), paymentDate }
            }
          })
        )
      ).not.toThrow()
    }
  )

  // RA-782. With no payment date there are no payment details to read.
  test('accepts a Standard-lifecycle opt-in with no payment date and no payment details', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: { standardLifecycle: { paymentDate: false } }
        })
      )
    ).not.toThrow()
  })

  test('rejects a Standard-lifecycle paymentDate that is not a boolean', () => {
    expect(() =>
      assertValidWorkItemModule(
        validModule({
          type: {
            standardLifecycle: {
              readPaymentDetails: () => ({}),
              paymentDate: 'false'
            }
          }
        })
      )
    ).toThrow(/`standardLifecycle.paymentDate` must be a boolean/)
  })

  // RA-410. `getTasksForState` is no longer part of the type contract, so
  // there is nothing left to validate — the two suites that asserted the
  // validator rejected a missing / non-function member went with it.
})
