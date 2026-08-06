import { describe, expect, test, beforeEach } from 'vitest'

import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '../core/registry.js'
import { reAccreditationType } from './module.js'
import { evaluateApproveEligibility } from './approve-eligibility.js'

/**
 * RA-346. The single gate behind BOTH the Approve CTA's visibility and the
 * approve route's own guard. Tests run against the REAL module declaration,
 * not a fixture, so a regression in `module.js` (e.g. dropping
 * `requiresAllTasksComplete` from the `approve` transition, or removing the
 * `record-decision-rationale` task) fails here.
 */

const COMPLETE = {
  taskId: 'record-decision-rationale',
  displayName: 'Record decision rationale',
  status: 'Completed'
}

function aWorkItem(overrides = {}) {
  return {
    id: 'wi-1',
    typeId: 're-accreditation',
    stateId: 'awaiting-decision',
    tasks: [COMPLETE],
    ...overrides
  }
}

describe('evaluateApproveEligibility', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
    registerWorkItemType(reAccreditationType)
  })

  test('allows approval in awaiting-decision with every task complete', () => {
    expect(evaluateApproveEligibility(aWorkItem())).toEqual({ allowed: true })
  })

  // THE RA-346 bug: this used to be allowed.
  test.each([['InProgress'], ['NotStarted']])(
    'blocks approval while the decision task is %s',
    (status) => {
      const result = evaluateApproveEligibility(
        aWorkItem({ tasks: [{ ...COMPLETE, status }] })
      )

      expect(result).toEqual({ allowed: false, reason: 'incomplete-tasks' })
    }
  )

  test('blocks approval when only some of several tasks are complete', () => {
    const result = evaluateApproveEligibility(
      aWorkItem({
        tasks: [
          COMPLETE,
          { ...COMPLETE, taskId: 'other', status: 'NotStarted' }
        ]
      })
    )

    expect(result).toEqual({ allowed: false, reason: 'incomplete-tasks' })
  })

  // The legacy `isComplete` fallback is owned and pinned by `isTaskComplete`
  // (see `core/task-status.js` and `core/engine.test.js`) — deliberately not
  // re-pinned here, so the behaviour has exactly one home.

  // Neither a missing NOR an empty `tasks` array proves the work is done, so
  // both fall through to the type declaration — which says there IS a
  // pending `record-decision-rationale`. Fail closed. The empty case is the
  // RA-346 review finding: the backend returns an empty task list when it
  // cannot resolve the template snapshot, and `[].every(...)` would have
  // vacuously permitted the approval.
  test.each([
    ['a missing tasks array', undefined],
    ['an empty tasks array', []]
  ])('blocks approval for %s', (_label, tasks) => {
    const item = aWorkItem()
    if (tasks === undefined) {
      delete item.tasks
    } else {
      item.tasks = tasks
    }

    expect(evaluateApproveEligibility(item)).toEqual({
      allowed: false,
      reason: 'incomplete-tasks'
    })
  })

  test('blocks approval from a non-decision state', () => {
    expect(
      evaluateApproveEligibility(
        aWorkItem({ stateId: 'assessment-in-progress' })
      )
    ).toEqual({ allowed: false, reason: 'invalid-transition' })
  })

  test('blocks approval from a terminal state', () => {
    expect(
      evaluateApproveEligibility(aWorkItem({ stateId: 'approved' }))
    ).toEqual({ allowed: false, reason: 'terminal-state' })
  })

  test('blocks approval for a work item of another type', () => {
    expect(
      evaluateApproveEligibility(aWorkItem({ typeId: 'something-else' }))
    ).toEqual({ allowed: false, reason: 'wrong-type' })
  })

  // A work item with no typeId is still evaluated — the generic detail
  // controller only calls this for re-accreditation items anyway.
  test('evaluates a work item with no typeId', () => {
    const item = aWorkItem()
    delete item.typeId

    expect(evaluateApproveEligibility(item)).toEqual({ allowed: true })
  })

  test('handles a null work item without throwing', () => {
    expect(evaluateApproveEligibility(null)).toEqual({
      allowed: false,
      reason: 'invalid-work-item'
    })
  })

  // Fail CLOSED when the module is not registered: never offer an approval
  // we cannot verify against a declaration. The reason must be DISTINCT from
  // the engine's `unknown-action`, which the controller renders as "can no
  // longer be approved from its current state" — misleading for what is
  // actually a server wiring fault.
  test('blocks approval with a distinct reason when the type is not registered', () => {
    clearWorkItemRegistry()

    expect(evaluateApproveEligibility(aWorkItem())).toEqual({
      allowed: false,
      reason: 'type-not-registered'
    })
  })
})
