/**
 * Single gate for the Standard-lifecycle "Change valid from date" flow
 * (RA-800).
 *
 * Used by BOTH the link's visibility check
 * (`routes/work-items/standard-lifecycle-view-model.js`) and the change page's
 * own guard (`./controller.js`), so the link and the URL can never disagree.
 *
 * The rule mirrors management-be's change-valid-from service: only an
 * approved determination still awaiting applicant contact (step 1,
 * `approved-pending-contact`) can be corrected, and only if there is a valid
 * from date to correct. Granted and Refused cases, a refusal awaiting contact
 * (which records no date) and every earlier state are refused. The type must
 * also take a valid from date (`standardLifecycle.effectiveDate`), so the
 * capability is opt-in.
 *
 * Gated on the RAW backend DTO, never a decorated view model. The backend
 * remains authoritative and answers 409 to a forged POST.
 */

import { createLogger } from '#/server/common/helpers/logging/logger.js'

import { resolveScopedType, takesEffectiveDate } from '../lifecycle.js'
import { STATE_APPROVED_PENDING_CONTACT } from '../states.js'

const logger = createLogger()

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The work item's stored valid from date (`payload.effectiveDate`) as
 * `{ iso, display }`, or `null` when absent or not a plain `YYYY-MM-DD`
 * string. `display` is `dd/mm/yyyy`.
 */
export function readValidFromDate(workItem) {
  const raw = workItem?.payload?.effectiveDate
  const match = typeof raw === 'string' ? ISO_DATE.exec(raw) : null
  if (!match) {
    return null
  }
  const [, year, month, day] = match
  return { iso: raw, display: `${day}/${month}/${year}` }
}

/**
 * Can this work item's valid from date be changed right now?
 *
 * @param {object} workItem A work item as returned by the backend.
 * @param {{ typeId: string }} scope The type whose page or link is asking.
 * @returns {{ allowed: boolean, reason?: string }} `reason` is one of
 *   `'wrong-type'`, `'type-not-registered'`, `'not-supported'`,
 *   `'invalid-work-item'`, `'invalid-state'` or `'no-valid-from-date'`.
 */
export function evaluateChangeValidFromEligibility(workItem, { typeId }) {
  const scoped = resolveScopedType(
    workItem,
    typeId,
    logger,
    'changing the valid from date'
  )
  if (!scoped.type) {
    return { allowed: false, reason: scoped.reason }
  }

  if (!takesEffectiveDate(typeId)) {
    return { allowed: false, reason: 'not-supported' }
  }

  if (!workItem?.stateId) {
    return { allowed: false, reason: 'invalid-work-item' }
  }

  if (workItem.stateId !== STATE_APPROVED_PENDING_CONTACT) {
    return { allowed: false, reason: 'invalid-state' }
  }

  if (!readValidFromDate(workItem)) {
    return { allowed: false, reason: 'no-valid-from-date' }
  }

  return { allowed: true }
}
