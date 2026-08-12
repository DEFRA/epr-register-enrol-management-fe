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
    // Deliberately does NOT set `isTaskWaypoint`: it is derived by the
    // view-model layer and never appears on the raw DTO this helper is
    // given. Putting it here would be a fixture asserting an assumption
    // instead of the wire — which is exactly how the earlier bug hid.
    function aWaypointItem(taskStateId) {
      return aWorkItem({ stateId: 'updated', taskStateId })
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

    /**
     * The real unresolvable-origin shape, verified by management-be
     * against actual serialised responses. `taskStateId` is ALWAYS
     * present and non-null on the wire — when no redirect applies it
     * falls back to the item's own `stateId`. So an `updated` item with
     * no resume history reports `taskStateId: 'updated'`, and is refused
     * because it fails the equality rather than because of any null
     * check. The backend answers 409 for these, so a CTA would always
     * fail.
     */
    test('refuses an updated item with no resume history (taskStateId echoes stateId)', () => {
      expect(evaluateDulyMakeEligibility(aWaypointItem('updated'))).toEqual({
        allowed: false,
        reason: 'invalid-transition'
      })
    })

    test('refuses a null or absent taskStateId without a special case', () => {
      // Not a shape the backend emits — asserted only to show the strict
      // equality handles it, so nobody adds a null-guard for a case that
      // cannot occur.
      expect(evaluateDulyMakeEligibility(aWaypointItem(null)).allowed).toBe(
        false
      )
      expect(
        evaluateDulyMakeEligibility(aWaypointItem(undefined)).allowed
      ).toBe(false)
    })

    /**
     * ⚠ THE REGRESSION GUARD. `isTaskWaypoint` is NOT a wire field — the
     * detail controller DERIVES it when building the view model — but
     * this helper is handed the RAW backend DTO, which therefore never
     * carries it. An earlier version of the gate required
     * `isTaskWaypoint === true` and so refused every waypoint item in
     * production while passing its unit tests, because the fixtures set
     * the flag by hand. These two cases pin the raw shape.
     */
    test('allows on a raw DTO that carries no isTaskWaypoint flag', () => {
      const raw = {
        id: 'wi-1',
        typeId: 're-accreditation',
        stateId: 'updated',
        taskStateId: 'submitted'
      }
      expect('isTaskWaypoint' in raw).toBe(false)
      expect(evaluateDulyMakeEligibility(raw)).toEqual({ allowed: true })
    })

    test('ignores isTaskWaypoint entirely — taskStateId is the rule', () => {
      // Even an explicitly false flag must not override the real signal,
      // so nobody can "fix" this by re-adding the derived check.
      expect(
        evaluateDulyMakeEligibility(
          aWorkItem({
            stateId: 'updated',
            isTaskWaypoint: false,
            taskStateId: 'submitted'
          })
        ).allowed
      ).toBe(true)
      expect(
        evaluateDulyMakeEligibility(
          aWorkItem({
            stateId: 'updated',
            isTaskWaypoint: true,
            taskStateId: 'assessment-in-progress'
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
