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
  targetStateForOutcome
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

  test('allows a decision from duly-made (RA-595: the submit starts assessment first)', () => {
    // A frontend-only rule. The backend still refuses `/decision` from
    // `duly-made`; the submit route applies `start-assessment` before it.
    expect(
      evaluateLogDecisionEligibility(aWorkItem({ stateId: 'duly-made' }))
    ).toEqual({ allowed: true })
  })

  test('allows a decision from assessment-started (RA-527 follow-up: a started case still reads Duly made)', () => {
    // management-be v18 takes `submit-for-decision` from the started state
    // and then the decision, as it does from `assessment-in-progress`.
    expect(
      evaluateLogDecisionEligibility(
        aWorkItem({ stateId: 'assessment-started' })
      )
    ).toEqual({ allowed: true })
  })

  // RA-527: an approval awaiting applicant contact is already determined.
  test.each([
    ['submitted'],
    ['queried'],
    ['updated'],
    ['approved-pending-contact']
  ])('refuses a decision from %s', (stateId) => {
    expect(evaluateLogDecisionEligibility(aWorkItem({ stateId }))).toEqual({
      allowed: false,
      reason: 'invalid-transition'
    })
  })

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

describe('targetStateForOutcome', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
    registerWorkItemType(reAccreditationType)
  })

  // RA-527: step 1 of an approval, not yet the terminal 'approved'.
  test('approved lands on the approved-pending-contact state', () => {
    expect(targetStateForOutcome('approved')).toBe('approved-pending-contact')
  })

  test('rejected lands on step 1 of a refusal — NOT a "refused" state', () => {
    // RA-527: a refusal is two steps; step 1 lands in rejected-pending-contact.
    // "Refused" is a label change only: the state ids are unchanged.
    expect(targetStateForOutcome('rejected')).toBe('rejected-pending-contact')
  })

  test('returns null for an invalid outcome', () => {
    expect(targetStateForOutcome('refused')).toBeNull()
  })
})

describe('DECISION_OUTCOMES', () => {
  test('maps the two wire values onto the step 1 transition ids', () => {
    expect(DECISION_OUTCOMES).toEqual({
      approved: 'make-determination-approved',
      rejected: 'make-determination-rejected'
    })
  })

  test('is frozen so a caller cannot widen the accepted set', () => {
    expect(Object.isFrozen(DECISION_OUTCOMES)).toBe(true)
  })
})
