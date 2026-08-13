import { describe, test, expect } from 'vitest'

import { canApplyAction, isCallerInvocable, projectWorkItem } from './engine.js'

const sampleType = (overrides = {}) => ({
  id: 'sample',
  displayName: 'Sample',
  initialState: { id: 'submitted', displayName: 'Submitted' },
  states: [
    { id: 'submitted', displayName: 'Submitted' },
    { id: 'approved', displayName: 'Approved', isTerminal: true },
    { id: 'rejected', displayName: 'Rejected', isTerminal: true }
  ],
  transitions: [
    {
      actionId: 'approve',
      displayName: 'Approve',
      fromStateId: 'submitted',
      toStateId: 'approved'
    },
    {
      actionId: 'reject',
      displayName: 'Reject',
      fromStateId: 'submitted',
      toStateId: 'rejected'
    },
    {
      actionId: 'withdraw',
      displayName: 'Withdraw',
      fromStateId: 'submitted',
      toStateId: 'rejected'
    }
  ],
  ...overrides
})

describe('projectWorkItem', () => {
  // RA-410. Every action from the current state is now offered — there is no
  // completion gate left to filter any of them out. The suite this replaced
  // asserted the opposite (only `withdraw` until tasks were ticked), which is
  // the behaviour the ticket removed.
  test('offers every caller-invocable action from the current state', () => {
    const projection = projectWorkItem(sampleType(), { stateId: 'submitted' })

    expect(projection.availableActions.map((a) => a.actionId)).toEqual([
      'approve',
      'reject',
      'withdraw'
    ])
  })

  test('does not project a tasks array at all', () => {
    const projection = projectWorkItem(sampleType(), { stateId: 'submitted' })

    expect(projection).not.toHaveProperty('tasks')
  })

  test('returns no actions when work item is in a terminal state', () => {
    const projection = projectWorkItem(sampleType(), { stateId: 'approved' })

    expect(projection.availableActions).toEqual([])
  })

  test('returns empty projection for an unknown type', () => {
    expect(projectWorkItem(undefined, { stateId: 'submitted' })).toEqual({
      availableActions: []
    })
  })
})

describe('canApplyAction', () => {
  test('allows an action whose from-state matches', () => {
    expect(
      canApplyAction(sampleType(), { stateId: 'submitted' }, 'withdraw')
    ).toEqual({
      allowed: true
    })
  })

  // RA-410. There is no `incomplete-tasks` rejection any more: the property
  // that produced it is gone from the wire contract. An action is allowed on
  // its from-state, full stop.
  test('no longer blocks an action on task completion', () => {
    expect(
      canApplyAction(sampleType(), { stateId: 'submitted' }, 'approve')
    ).toEqual({
      allowed: true
    })
  })

  test('blocks any action in a terminal state', () => {
    expect(
      canApplyAction(sampleType(), { stateId: 'approved' }, 'approve')
    ).toEqual({
      allowed: false,
      reason: 'terminal-state'
    })
  })

  test('rejects an action whose from-state does not match', () => {
    const type = sampleType({
      transitions: [
        {
          actionId: 'reopen',
          displayName: 'Reopen',
          fromStateId: 'rejected',
          toStateId: 'submitted'
        }
      ],
      states: [
        { id: 'submitted', displayName: 'Submitted' },
        { id: 'rejected', displayName: 'Rejected' }
      ]
    })
    expect(canApplyAction(type, { stateId: 'submitted' }, 'reopen')).toEqual({
      allowed: false,
      reason: 'invalid-transition'
    })
  })

  test('rejects an unknown action id', () => {
    expect(
      canApplyAction(sampleType(), { stateId: 'submitted' }, 'teleport')
    ).toEqual({
      allowed: false,
      reason: 'unknown-action'
    })
  })

  test('rejects a null work item without throwing', () => {
    expect(canApplyAction(sampleType(), null, 'approve')).toEqual({
      allowed: false,
      reason: 'invalid-work-item'
    })
  })

  test('rejects an undefined work item without throwing', () => {
    expect(canApplyAction(sampleType(), undefined, 'approve')).toEqual({
      allowed: false,
      reason: 'invalid-work-item'
    })
  })

  // RA-372 -----------------------------------------------------------------
  test('rejects a transition the backend reserves to itself', () => {
    const type = sampleType({
      transitions: [
        {
          actionId: 'server-resolved',
          displayName: 'Server resolved',
          fromStateId: 'submitted',
          toStateId: 'approved',
          requiresAllTasksComplete: false,
          callerInvocable: false
        }
      ]
    })

    expect(
      canApplyAction(type, { stateId: 'submitted' }, 'server-resolved')
    ).toEqual({
      allowed: false,
      reason: 'not-caller-invocable'
    })
  })

  test('allows a transition that explicitly opts in to being caller-invocable', () => {
    const type = sampleType({
      transitions: [
        {
          actionId: 'withdraw',
          displayName: 'Withdraw',
          fromStateId: 'submitted',
          toStateId: 'rejected',
          requiresAllTasksComplete: false,
          callerInvocable: true
        }
      ]
    })

    expect(canApplyAction(type, { stateId: 'submitted' }, 'withdraw')).toEqual({
      allowed: true
    })
  })
})

// RA-372. The backend declares transitions it resolves on the caller's
// behalf as `CallerInvocable: false` and never projects them into
// `availableActions` — re-accreditation's four `continue-review-during-*`
// transitions all share `fromStateId: 'updated'`, so offering them as a
// caller choice would let the caller pick the destination state. The
// mirror has to reproduce that, or it advertises actions the UI must never
// render as buttons.
describe('projectWorkItem — caller-invocable transitions', () => {
  const withServerResolvedTransition = (overrides = {}) =>
    sampleType({
      transitions: [
        {
          actionId: 'withdraw',
          displayName: 'Withdraw',
          fromStateId: 'submitted',
          toStateId: 'rejected',
          requiresAllTasksComplete: false
        },
        {
          actionId: 'server-resolved',
          displayName: 'Server resolved',
          fromStateId: 'submitted',
          toStateId: 'approved',
          requiresAllTasksComplete: false,
          callerInvocable: false,
          ...overrides
        }
      ]
    })

  test('omits a transition flagged callerInvocable: false', () => {
    const projection = projectWorkItem(withServerResolvedTransition(), {
      stateId: 'submitted'
    })

    expect(projection.availableActions.map((a) => a.actionId)).toEqual([
      'withdraw'
    ])
  })

  test('omits it even when every task is complete', () => {
    const projection = projectWorkItem(withServerResolvedTransition(), {
      stateId: 'submitted',
      completedTaskIdsByState: {
        submitted: ['check-eligibility', 'verify-documents']
      }
    })

    expect(projection.availableActions.map((a) => a.actionId)).not.toContain(
      'server-resolved'
    )
  })

  test('treats an omitted flag as invocable, matching the backend default', () => {
    const projection = projectWorkItem(
      withServerResolvedTransition({ callerInvocable: undefined }),
      { stateId: 'submitted' }
    )

    expect(projection.availableActions.map((a) => a.actionId)).toEqual([
      'withdraw',
      'server-resolved'
    ])
  })

  test('keeps a transition that explicitly opts in', () => {
    const projection = projectWorkItem(
      withServerResolvedTransition({ callerInvocable: true }),
      { stateId: 'submitted' }
    )

    expect(projection.availableActions.map((a) => a.actionId)).toEqual([
      'withdraw',
      'server-resolved'
    ])
  })
})

// ---------------------------------------------------------------------
describe('isCallerInvocable', () => {
  test('suppresses an action flagged callerInvocable: false', () => {
    expect(
      isCallerInvocable({
        actionId: 'resume-during-assessment',
        displayName: 'Resume',
        callerInvocable: false
      })
    ).toBe(false)
  })

  test('admits an action flagged callerInvocable: true', () => {
    expect(
      isCallerInvocable({
        actionId: 'withdraw-during-query',
        displayName: 'Withdraw',
        callerInvocable: true
      })
    ).toBe(true)
  })

  // The flag is absent from older backend payloads and from every fixture
  // written before RA-364. Treating "missing" as invocable is what keeps
  // those rendering exactly as they always did.
  test('admits an action with the flag absent', () => {
    expect(
      isCallerInvocable({ actionId: 'withdraw', displayName: 'Withdraw' })
    ).toBe(true)
  })

  test('admits an action with the flag explicitly undefined', () => {
    expect(
      isCallerInvocable({ actionId: 'withdraw', callerInvocable: undefined })
    ).toBe(true)
  })

  // Only a boolean `false` suppresses. A malformed or absent action fails
  // TOWARDS rendering rather than silently blanking the actions panel, and
  // must not throw.
  test.each([
    ['null', null],
    ['undefined', undefined]
  ])('admits a %s action rather than throwing', (_label, action) => {
    expect(isCallerInvocable(action)).toBe(true)
  })

  test('is not fooled by a falsy-but-not-false flag', () => {
    expect(isCallerInvocable({ actionId: 'a', callerInvocable: 0 })).toBe(true)
    expect(isCallerInvocable({ actionId: 'a', callerInvocable: '' })).toBe(true)
  })

  // The flag is the signal, NEVER the display name: two distinct actions may
  // legitimately share a label, so de-duplicating by label would suppress a
  // real affordance.
  test('does not suppress duplicate labels that are caller-invocable', () => {
    const actions = [
      { actionId: 'withdraw-during-query', displayName: 'Withdraw' },
      { actionId: 'withdraw-during-updated', displayName: 'Withdraw' }
    ]
    expect(actions.filter(isCallerInvocable)).toHaveLength(2)
  })

  test('filters a mixed list down to the invocable entries only', () => {
    const actions = [
      { actionId: 'resume-during-duly-making', callerInvocable: false },
      { actionId: 'resume-during-duly-made', callerInvocable: false },
      { actionId: 'withdraw-during-query' },
      { actionId: 'query-during-assessment', callerInvocable: true }
    ]
    expect(actions.filter(isCallerInvocable).map((a) => a.actionId)).toEqual([
      'withdraw-during-query',
      'query-during-assessment'
    ])
  })
})
