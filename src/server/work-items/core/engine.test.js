import { describe, test, expect } from 'vitest'

import { allTasksComplete, canApplyAction, projectWorkItem } from './engine.js'

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

// ---------------------------------------------------------------------
// RA-346. `allTasksComplete` resolves task state from EITHER shape callers
// hold: a work item the backend returned (authoritative `tasks` array with
// a canonical `status`) or a bare `{ stateId, completedTaskIdsByState }`
// that has to be derived from the type declaration. One predicate, so the
// Approve CTA and the approve route cannot drift apart.
// ---------------------------------------------------------------------
describe('allTasksComplete', () => {
  test('prefers the backend tasks array over the type declaration', () => {
    // The declaration says `submitted` has two tasks and nothing is
    // recorded as complete — but the backend says otherwise, and it wins.
    const workItem = {
      stateId: 'submitted',
      tasks: [
        { taskId: 'check-eligibility', status: 'Completed' },
        { taskId: 'verify-documents', status: 'Completed' }
      ]
    }

    expect(allTasksComplete(sampleType(), workItem)).toBe(true)
  })

  test('reports false when any task in the backend array is pending', () => {
    const workItem = {
      stateId: 'submitted',
      tasks: [
        { taskId: 'check-eligibility', status: 'Completed' },
        { taskId: 'verify-documents', status: 'InProgress' }
      ]
    }

    expect(allTasksComplete(sampleType(), workItem)).toBe(false)
  })

  test('honours the legacy isComplete boolean in the backend array', () => {
    expect(
      allTasksComplete(sampleType(), {
        stateId: 'submitted',
        tasks: [{ taskId: 'check-eligibility', isComplete: true }]
      })
    ).toBe(true)
    expect(
      allTasksComplete(sampleType(), {
        stateId: 'submitted',
        tasks: [{ taskId: 'check-eligibility', isComplete: false }]
      })
    ).toBe(false)
  })

  test('an empty backend tasks array counts as complete', () => {
    expect(
      allTasksComplete(sampleType(), { stateId: 'submitted', tasks: [] })
    ).toBe(true)
  })

  test('falls back to the type declaration when there is no tasks array', () => {
    expect(allTasksComplete(sampleType(), { stateId: 'submitted' })).toBe(false)
    expect(
      allTasksComplete(sampleType(), {
        stateId: 'submitted',
        completedTaskIdsByState: {
          submitted: ['check-eligibility', 'verify-documents']
        }
      })
    ).toBe(true)
  })

  test('a state with no declared tasks counts as complete', () => {
    expect(allTasksComplete(sampleType(), { stateId: 'approved' })).toBe(true)
  })

  test('handles a null work item without throwing', () => {
    expect(allTasksComplete(sampleType(), null)).toBe(true)
  })
})
