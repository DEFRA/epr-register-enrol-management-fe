import { describe, test, expect } from 'vitest'

import { canApplyAction, projectWorkItem } from './engine.js'

const sampleType = (overrides = {}) => ({
  id: 'sample',
  displayName: 'Sample',
  initialState: { id: 'submitted', displayName: 'Submitted' },
  states: [
    { id: 'submitted', displayName: 'Submitted' },
    { id: 'approved', displayName: 'Approved', isTerminal: true },
    { id: 'rejected', displayName: 'Rejected', isTerminal: true }
  ],
  getTasksForState(stateId) {
    if (stateId === 'submitted') {
      return [
        { id: 'check-eligibility', displayName: 'Check eligibility' },
        { id: 'verify-documents', displayName: 'Verify documents' }
      ]
    }
    return []
  },
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
      toStateId: 'rejected',
      requiresAllTasksComplete: false
    }
  ],
  ...overrides
})

describe('projectWorkItem', () => {
  test('reports incomplete tasks and only ungated actions when nothing is done', () => {
    const projection = projectWorkItem(sampleType(), { stateId: 'submitted' })

    expect(projection.tasks).toHaveLength(2)
    expect(projection.tasks.every((t) => t.isComplete === false)).toBe(true)
    expect(projection.availableActions.map((a) => a.actionId)).toEqual([
      'withdraw'
    ])
  })

  test('makes gated actions available once every task is complete', () => {
    const projection = projectWorkItem(sampleType(), {
      stateId: 'submitted',
      completedTaskIdsByState: {
        submitted: ['check-eligibility', 'verify-documents']
      }
    })

    expect(projection.tasks.every((t) => t.isComplete)).toBe(true)
    expect(projection.availableActions.map((a) => a.actionId)).toEqual([
      'approve',
      'reject',
      'withdraw'
    ])
  })

  test('returns no actions when work item is in a terminal state', () => {
    const projection = projectWorkItem(sampleType(), { stateId: 'approved' })

    expect(projection.availableActions).toEqual([])
    expect(projection.tasks).toEqual([])
  })

  test('returns empty projection for an unknown type', () => {
    expect(projectWorkItem(undefined, { stateId: 'submitted' })).toEqual({
      tasks: [],
      availableActions: []
    })
  })
})

describe('canApplyAction', () => {
  test('allows an action that requires no tasks regardless of progress', () => {
    expect(
      canApplyAction(sampleType(), { stateId: 'submitted' }, 'withdraw')
    ).toEqual({
      allowed: true
    })
  })

  test('blocks a gated action when tasks are outstanding', () => {
    expect(
      canApplyAction(sampleType(), { stateId: 'submitted' }, 'approve')
    ).toEqual({
      allowed: false,
      reason: 'incomplete-tasks'
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
