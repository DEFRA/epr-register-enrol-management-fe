import { describe, expect, test, beforeEach } from 'vitest'

import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '../../core/registry.js'
import { reAccreditationType } from '../module.js'
import {
  DECISION_OUTCOMES,
  evaluateLogDecisionEligibility,
  isValidDecisionOutcome,
  terminalStateForOutcome
} from './eligibility.js'

/**
 * RA-410. The single gate behind BOTH the Log decision CTA's visibility and
 * the decision route's own guard. Tests run against the REAL module
 * declaration, so changing a decision transition's `fromStateId` /
 * `toStateId` in `module.js` moves these with it rather than letting the two
 * drift apart.
 */

function aWorkItem(overrides = {}) {
  return {
    id: 'wi-1',
    typeId: 're-accreditation',
    stateId: 'assessment-in-progress',
    ...overrides
  }
}

describe('evaluateLogDecisionEligibility', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
    registerWorkItemType(reAccreditationType)
  })

  test('allows a decision from assessment-in-progress (the normal path)', () => {
    expect(evaluateLogDecisionEligibility(aWorkItem())).toEqual({
      allowed: true
    })
  })

  test('allows a decision from awaiting-decision (the rescue path)', () => {
    // Items already parked in `awaiting-decision` when RA-410 shipped, and
    // any left there by a mid-hop backend failure, must stay resolvable —
    // nothing else in the new UI offers a button from that state.
    expect(
      evaluateLogDecisionEligibility(
        aWorkItem({ stateId: 'awaiting-decision' })
      )
    ).toEqual({ allowed: true })
  })

  test('does NOT require tasks to be complete', () => {
    // RA-346's gate is gone with the tasks feature. An item carrying a
    // leftover task array from a pre-v12 snapshot must still be decidable.
    expect(
      evaluateLogDecisionEligibility(
        aWorkItem({
          tasks: [{ id: 'record-decision-rationale', status: 'NotStarted' }]
        })
      )
    ).toEqual({ allowed: true })
  })

  test.each([['submitted'], ['duly-made'], ['queried'], ['updated']])(
    'refuses a decision from %s',
    (stateId) => {
      expect(evaluateLogDecisionEligibility(aWorkItem({ stateId }))).toEqual({
        allowed: false,
        reason: 'invalid-transition'
      })
    }
  )

  test.each([['approved'], ['rejected'], ['withdrawn']])(
    'reports terminal-state (not invalid-transition) for an already-closed %s item',
    (stateId) => {
      // The distinction drives which banner the user sees, and they are not
      // interchangeable: "already decided" sends them to look at the
      // outcome, "wrong stage" sends them back to the assessment.
      expect(evaluateLogDecisionEligibility(aWorkItem({ stateId }))).toEqual({
        allowed: false,
        reason: 'terminal-state'
      })
    }
  )

  test('refuses a work item of a different type', () => {
    expect(
      evaluateLogDecisionEligibility(aWorkItem({ typeId: 'something-else' }))
    ).toEqual({ allowed: false, reason: 'wrong-type' })
  })

  test('refuses a work item with no state', () => {
    expect(
      evaluateLogDecisionEligibility(aWorkItem({ stateId: undefined }))
    ).toEqual({ allowed: false, reason: 'invalid-work-item' })
  })

  test('fails CLOSED and distinctly when the type is not registered', () => {
    clearWorkItemRegistry()
    expect(evaluateLogDecisionEligibility(aWorkItem())).toEqual({
      allowed: false,
      reason: 'type-not-registered'
    })
  })

  test('is evaluated against the RAW backend DTO, not a decorated view model', () => {
    // The detail controller passes `source` and the route passes the
    // untouched `getWorkItem` result. A DTO carrying only the wire fields
    // must be enough — if this ever needed a derived flag, the CTA and the
    // route would silently disagree.
    expect(
      evaluateLogDecisionEligibility({
        typeId: 're-accreditation',
        stateId: 'assessment-in-progress'
      })
    ).toEqual({ allowed: true })
  })
})

describe('isValidDecisionOutcome', () => {
  test.each([['approved'], ['rejected']])('accepts %s', (outcome) => {
    expect(isValidDecisionOutcome(outcome)).toBe(true)
  })

  test.each([
    ['refused'],
    ['approve'],
    ['reject'],
    ['Approved'],
    [''],
    [null],
    [undefined],
    [42]
  ])('rejects %s', (outcome) => {
    expect(isValidDecisionOutcome(outcome)).toBe(false)
  })

  test('rejects inherited Object properties', () => {
    // Guards the `Object.hasOwn` in the implementation: a plain `in` check
    // would accept `toString` / `constructor` and post them to the backend.
    expect(isValidDecisionOutcome('toString')).toBe(false)
    expect(isValidDecisionOutcome('constructor')).toBe(false)
  })
})

describe('terminalStateForOutcome', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
    registerWorkItemType(reAccreditationType)
  })

  test('approved lands on the approved state', () => {
    expect(terminalStateForOutcome('approved')).toBe('approved')
  })

  test('rejected lands on the rejected state — NOT a "refused" state', () => {
    // "Refused" is a label change only. The state id, the transition id and
    // the notification templates are all unchanged.
    expect(terminalStateForOutcome('rejected')).toBe('rejected')
  })

  test('returns null for an invalid outcome', () => {
    expect(terminalStateForOutcome('refused')).toBeNull()
  })
})

describe('DECISION_OUTCOMES', () => {
  test('maps the two wire values onto the unchanged transition ids', () => {
    expect(DECISION_OUTCOMES).toEqual({
      approved: 'approve',
      rejected: 'reject'
    })
  })

  test('is frozen so a caller cannot widen the accepted set', () => {
    expect(Object.isFrozen(DECISION_OUTCOMES)).toBe(true)
  })
})
