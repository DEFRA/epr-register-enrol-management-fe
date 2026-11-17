/**
 * Re-accreditation's "Log decision" gate (RA-410). RA-495: the rule is the
 * shared Standard-lifecycle one, scoped to the re-accreditation type — see
 * `standard-lifecycle/decision/eligibility.js`.
 */

import {
  evaluateLogDecisionEligibility as evaluateStandardLogDecisionEligibility,
  targetStateForOutcome as standardTargetStateForOutcome
} from '../../core/standard-lifecycle/decision/eligibility.js'
import { RE_ACCREDITATION_TYPE_ID } from '../type-id.js'

export {
  DECISION_OUTCOMES,
  isValidDecisionOutcome
} from '../../core/standard-lifecycle/decision/eligibility.js'
export { RE_ACCREDITATION_TYPE_ID }

const SCOPE = Object.freeze({ typeId: RE_ACCREDITATION_TYPE_ID })

/**
 * Can a decision be logged against this re-accreditation work item now?
 *
 * @param {object} workItem the RAW backend DTO
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function evaluateLogDecisionEligibility(workItem) {
  return evaluateStandardLogDecisionEligibility(workItem, SCOPE)
}

/**
 * The state id a re-accreditation outcome lands on.
 *
 * @param {string} outcome `'approved'` | `'rejected'`
 * @returns {string|null}
 */
export function targetStateForOutcome(outcome) {
  return standardTargetStateForOutcome(outcome, SCOPE)
}
