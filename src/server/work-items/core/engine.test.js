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
})
