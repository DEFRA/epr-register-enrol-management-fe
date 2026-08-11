import { describe, expect, test, beforeEach } from 'vitest'

import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '../../core/registry.js'
import { canApplyAction } from '../../core/engine.js'
import { reAccreditationType } from '../module.js'
import { evaluateDulyMakeEligibility } from './eligibility.js'

/**
 * RA-316. The single gate behind BOTH the Duly make CTA's visibility and
 * the duly-making route's own guard. Tests run against the REAL module
 * declaration, so changing `duly-make`'s `fromStateId` in `module.js`
 * moves these with it rather than letting the two drift apart.
 */

function aWorkItem(overrides = {}) {
  return {
    id: 'wi-1',
    typeId: 're-accreditation',
    stateId: 'submitted',
    ...overrides
  }
}

describe('evaluateDulyMakeEligibility', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
    registerWorkItemType(reAccreditationType)
  })

  test('allows duly making from submitted', () => {
    expect(evaluateDulyMakeEligibility(aWorkItem())).toEqual({ allowed: true })
  })

  test('does NOT require tasks to be complete', () => {
    // `submitted` has no tasks at all any more; an empty task array must
    // not be read as "outstanding work".
    expect(evaluateDulyMakeEligibility(aWorkItem({ tasks: [] })).allowed).toBe(
      true
    )
  })

  test.each([
    'duly-made',
    'assessment-in-progress',
    'awaiting-decision',
    'queried',
    'updated'
  ])('refuses from %s as an invalid transition', (stateId) => {
    expect(evaluateDulyMakeEligibility(aWorkItem({ stateId }))).toEqual({
      allowed: false,
      reason: 'invalid-transition'
    })
  })

  /**
   * RA-316, second entry point. An application queried DURING duly making
   * and then resubmitted sits in the `updated` waypoint. Without this the
   * item has no route to `duly-made` at all and strands — the regression
   * that removing the task-driven flow would otherwise introduce.
   */
  describe('the updated waypoint', () => {
    function aWaypointItem(taskStateId) {
      return aWorkItem({
        stateId: 'updated',
        isTaskWaypoint: true,
        taskStateId
      })
    }

    test('allows duly making when the query was raised during duly making', () => {
      expect(evaluateDulyMakeEligibility(aWaypointItem('submitted'))).toEqual({
        allowed: true
      })
    })

    test.each(['assessment-in-progress', 'awaiting-decision', 'duly-made'])(
      'refuses when the query was raised from %s',
      (taskStateId) => {
        // Offering Duly make here would invite a caseworker to send an
        // application backwards past assessment.
        expect(evaluateDulyMakeEligibility(aWaypointItem(taskStateId))).toEqual(
          { allowed: false, reason: 'invalid-transition' }
        )
      }
    )

    test('refuses when taskStateId is null (unresolvable pre-v8 origin)', () => {
      // The backend answers 409 for these, so a CTA would always fail.
      expect(evaluateDulyMakeEligibility(aWaypointItem(null)).allowed).toBe(
        false
      )
      expect(
        evaluateDulyMakeEligibility(aWaypointItem(undefined)).allowed
      ).toBe(false)
    })

    test('refuses when the item is not flagged as a waypoint', () => {
      expect(
        evaluateDulyMakeEligibility(
          aWorkItem({
            stateId: 'updated',
            isTaskWaypoint: false,
            taskStateId: 'submitted'
          })
        ).allowed
      ).toBe(false)
    })
  })

  test.each(['approved', 'rejected', 'withdrawn'])(
    'refuses from the terminal state %s',
    (stateId) => {
      expect(evaluateDulyMakeEligibility(aWorkItem({ stateId }))).toEqual({
        allowed: false,
        reason: 'terminal-state'
      })
    }
  )

  test('refuses a work item of another type', () => {
    expect(
      evaluateDulyMakeEligibility(aWorkItem({ typeId: 'something-else' }))
    ).toEqual({ allowed: false, reason: 'wrong-type' })
  })

  test('refuses a work item with no state', () => {
    expect(
      evaluateDulyMakeEligibility(aWorkItem({ stateId: undefined }))
    ).toEqual({ allowed: false, reason: 'invalid-work-item' })
  })

  test('fails closed and distinctly when the type is not registered', () => {
    clearWorkItemRegistry()
    expect(evaluateDulyMakeEligibility(aWorkItem())).toEqual({
      allowed: false,
      reason: 'type-not-registered'
    })
  })

  /**
   * The reason this helper exists instead of delegating to the engine.
   * If someone "simplifies" it into a `canApplyAction` call, this fails.
   */
  test('canApplyAction cannot be used — it refuses non-caller-invocable transitions', () => {
    const viaEngine = canApplyAction(
      reAccreditationType,
      aWorkItem(),
      'duly-make'
    )
    expect(viaEngine).toEqual({
      allowed: false,
      reason: 'not-caller-invocable'
    })
    // ...while the real gate allows it.
    expect(evaluateDulyMakeEligibility(aWorkItem()).allowed).toBe(true)
  })
})
