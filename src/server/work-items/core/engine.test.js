import { describe, test, expect } from 'vitest'

import {
  allTasksComplete,
  canApplyAction,
  isCallerInvocable,
  projectWorkItem
} from './engine.js'

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

  // RA-346 review. An empty array must NOT be read as "nothing to do, so
  // everything is complete" — `[].every(...)` is vacuously true, which fails
  // OPEN. The backend's `WorkItemService.Project` genuinely returns an empty
  // task list when it cannot resolve the template snapshot, so this is a
  // reachable state. It must fall through to the declaration and fail CLOSED.
  test('an empty backend tasks array falls through to the declaration', () => {
    expect(
      allTasksComplete(sampleType(), { stateId: 'submitted', tasks: [] })
    ).toBe(false)
  })

  test('an empty backend tasks array is complete only when the declaration has no tasks', () => {
    expect(
      allTasksComplete(sampleType(), { stateId: 'approved', tasks: [] })
    ).toBe(true)
  })

  // Belt and braces: the empty array must not become a way to bypass a gated
  // action via the public `canApplyAction` entry point either.
  test('an empty backend tasks array does not unlock a gated action', () => {
    expect(
      canApplyAction(
        sampleType(),
        { stateId: 'submitted', tasks: [] },
        'approve'
      )
    ).toEqual({ allowed: false, reason: 'incomplete-tasks' })
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

  // We cannot prove an item we do not have is complete, so fail closed.
  test('reports false for a missing work item', () => {
    expect(allTasksComplete(sampleType(), null)).toBe(false)
    expect(allTasksComplete(sampleType(), undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------
// RA-364. The backend used to project transitions the caller may NOT
// invoke: four `resume-during-*` out of `queried` (all labelled "Resume")
// and four `continue-review-during-*` out of `updated` (all labelled
// "Continue review"). The detail page rendered one control per entry, so the
// user saw four identical buttons, every one of which the backend rejected
// on click.
//
// management-be now filters them at source, so this predicate never fires
// against a patched backend. It is kept deliberately to cover the STALE
// backend case (frontend deployed ahead of backend) — see the header on the
// RA-364 block in `routes/work-items/detail.controller.test.js`. Not dead
// code.
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
