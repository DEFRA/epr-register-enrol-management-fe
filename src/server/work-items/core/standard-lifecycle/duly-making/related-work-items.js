/**
 * RA-495. The "Related change requests" on the Duly make page: the other
 * work items from the same submission (management-be matches them on the
 * submission reference), so the caseworker can see the whole payment. Shown
 * only for a type that declares `standardLifecycle.relatedWorkItems`.
 *
 * Read-only: reference, site, type, charge and current status. A failed read
 * never blocks duly making; the page says the list could not be loaded.
 */

import { getDulyMakeDetails } from '#/server/common/helpers/backend-api/backend-api.js'
import { formatChargeAmount } from '#/server/common/helpers/format/charge-amount.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { EM_DASH } from '#/server/routes/work-items/application-summary.js'
import { stateDisplayName } from '#/server/routes/work-items/case-header.js'

import { getWorkItemType } from '../../registry.js'
import { stateTagClass } from '../../state-badge.js'
import { getStandardLifecycle } from '../lifecycle.js'

const logger = createLogger()

/**
 * @param {object} args
 * @param {string} args.typeId the type whose Duly make page is rendering
 * @param {string} args.workItemId
 * @param {object|null} args.user
 * @returns {Promise<null | { unavailable: true } | { rows: object[] }>} null
 *   when the type does not list related work items
 */
export async function loadRelatedWorkItems({ typeId, workItemId, user }) {
  if (getStandardLifecycle(typeId)?.relatedWorkItems !== true) {
    return null
  }

  const result = await getDulyMakeDetails({ workItemId, user })
  if (!result.ok) {
    logger.warn(
      { workItemId, typeId, status: result.status, error: result.error },
      'Related change requests could not be loaded for duly making'
    )
    return { unavailable: true }
  }

  return { rows: (result.details?.relatedWorkItems ?? []).map(toRow) }
}

function toRow(related) {
  const type = getWorkItemType(related.typeId)
  return {
    id: related.id,
    reference: related.applicationReference || EM_DASH,
    site: siteLabel(related),
    type: type?.displayName ?? related.typeId ?? EM_DASH,
    charge: formatChargeAmount(related.chargePence) ?? EM_DASH,
    status: stateDisplayName(type, related.stateId),
    statusTagClass: stateTagClass(related.stateId)
  }
}

/** "Site name (ORS id)", as in the add-ORS case header title. */
function siteLabel({ siteName, orsId }) {
  const name = siteName || EM_DASH
  return orsId ? `${name} (${orsId})` : name
}
