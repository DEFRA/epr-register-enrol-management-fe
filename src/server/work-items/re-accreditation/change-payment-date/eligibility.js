/**
 * Single gate for the re-accreditation "Change payment date" flow (RA-576).
 *
 * Used by BOTH the link visibility check (`routes/work-items/detail.controller.js`)
 * and the change-payment-date routes' own guard (`./controller.js`), so the
 * link and the URL can never disagree — the same discipline as
 * `duly-making/eligibility.js`.
 *
 * The rule mirrors management-be's service: any non-terminal state is
 * editable (queried and updated items included, and so is one with a logged
 * decision awaiting approval), but only if there is a payment date to change.
 * Items duly made without a date (auto-duly-made, or after the
 * remove-payment-received migration) are refused and the link is hidden.
 *
 * Gated on the RAW backend DTO, never a decorated view model. The backend
 * remains authoritative and answers 409 to a forged POST.
 */

import { getWorkItemType } from '../../core/registry.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { RE_ACCREDITATION_TYPE_ID } from '../duly-making/eligibility.js'

const logger = createLogger()

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The work item's payment date as `{ iso, display }`, or `null` when absent
 * or not a plain `YYYY-MM-DD` string. `display` is `dd/mm/yyyy`.
 */
export function readPaymentDate(workItem) {
  const raw = workItem?.payload?.paymentDate
  const match = typeof raw === 'string' ? ISO_DATE.exec(raw) : null
  if (!match) {
    return null
  }
  const [, year, month, day] = match
  return { iso: raw, display: `${day}/${month}/${year}` }
}

/**
 * Can this work item's payment date be changed right now?
 *
 * @param {object} workItem A work item as returned by the backend.
 * @returns {{ allowed: boolean, reason?: string }} `reason` is one of
 *   `'wrong-type'`, `'type-not-registered'`, `'invalid-work-item'`,
 *   `'terminal-state'` or `'no-payment-date'`.
 */
export function evaluateChangePaymentDateEligibility(workItem) {
  if (
    workItem?.typeId != null &&
    workItem.typeId !== RE_ACCREDITATION_TYPE_ID
  ) {
    return { allowed: false, reason: 'wrong-type' }
  }

  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  if (!type) {
    logger.error(
      { typeId: RE_ACCREDITATION_TYPE_ID },
      'Re-accreditation type is not registered; refusing payment date change'
    )
    return { allowed: false, reason: 'type-not-registered' }
  }

  const stateId = workItem?.stateId
  if (!stateId) {
    return { allowed: false, reason: 'invalid-work-item' }
  }

  if (type.states?.find((s) => s.id === stateId)?.isTerminal) {
    return { allowed: false, reason: 'terminal-state' }
  }

  if (!readPaymentDate(workItem)) {
    return { allowed: false, reason: 'no-payment-date' }
  }

  return { allowed: true }
}
