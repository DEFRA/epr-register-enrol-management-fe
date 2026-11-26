/**
 * RA-769. The case's accreditation, read live through management-be, for the
 * Accreditation summary tab and (RA-770) the Related change requests tab's
 * Accreditation block.
 */

import { getAccreditationSummary } from '#/server/common/helpers/backend-api/backend-api.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'

const logger = createLogger()

/**
 * Why a read gave nothing to show, for the log: every other such read renders
 * the same unavailable message, so the log is the only place the cases differ.
 */
function unavailableOutcome(read) {
  if (read?.status === statusCodes.notFound) {
    return '404'
  }
  return read?.unusable ? 'unusable body' : 'unavailable'
}

/**
 * `{ registrationOnly, summary }`, where `summary` is the read
 * (`{ accreditation, accreditationStartDate }`) or null when there is nothing
 * to show. A registration-only case has no accreditation, so the backend is
 * not asked. Any other read with nothing to show is logged.
 *
 * @param {object} args
 * @param {object} args.workItem the case's work item
 * @param {object|null} args.user
 */
export async function readAccreditationSummary({ workItem, user }) {
  // A type's case has an accreditation unless the type says this one does not
  // (add-ORS: a registration-only change).
  const registrationOnly =
    getWorkItemType(workItem?.typeId)?.hasAccreditation?.(workItem?.payload) ===
    false
  if (registrationOnly) {
    return { registrationOnly, summary: null }
  }
  const read = await getAccreditationSummary({ workItemId: workItem.id, user })
  const summary = read?.ok && read.accreditation ? read : null
  if (!summary) {
    logger.warn(
      {
        workItemId: workItem.id,
        outcome: unavailableOutcome(read),
        status: read.status,
        error: read.error
      },
      'Accreditation summary not available'
    )
  }
  return { registrationOnly, summary }
}
