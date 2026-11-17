/**
 * Re-accreditation's "Duly make" gate (RA-316). RA-495: the rule is the
 * shared Standard-lifecycle one, scoped to the re-accreditation type — see
 * `standard-lifecycle/duly-making/eligibility.js`.
 */

import { evaluateDulyMakeEligibility as evaluateStandardDulyMakeEligibility } from '../../core/standard-lifecycle/duly-making/eligibility.js'
import { RE_ACCREDITATION_TYPE_ID } from '../type-id.js'

export { DULY_MAKE_ACTION_ID } from '../../core/standard-lifecycle/duly-making/eligibility.js'
export { RE_ACCREDITATION_TYPE_ID }

/**
 * Can this re-accreditation work item be duly made right now?
 *
 * @param {object} workItem the RAW backend DTO
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function evaluateDulyMakeEligibility(workItem) {
  return evaluateStandardDulyMakeEligibility(workItem, {
    typeId: RE_ACCREDITATION_TYPE_ID
  })
}
