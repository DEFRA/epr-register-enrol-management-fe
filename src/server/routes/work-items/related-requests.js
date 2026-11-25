/**
 * RA-770. The Related change requests tab of an In-Year Change case: every
 * request submitted with this one (management-be matches them on the
 * submission reference), ten to a page, with this one first on page 1, each
 * linking to its own case. Read-only.
 *
 * `relatedWorkItemRow` is shared with the Duly make page's related change
 * requests (RA-495), so both lists describe a request the same way.
 */

import { formatChargeAmount } from '#/server/common/helpers/format/charge-amount.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { EM_DASH } from './application-summary.js'
import { stateDisplayName } from './case-header.js'

export const RELATED_REQUESTS_UNAVAILABLE =
  'Related requests are not available at the moment.'
export const ACCREDITATION_HEADING = 'Accreditation'

/**
 * One request from the same submission: its reference, site ("Name (ORS id)"),
 * type, charge and status. A charge of nothing, or of £0, is the dash: there
 * is no fee.
 */
export function relatedWorkItemRow(related) {
  const type = getWorkItemType(related.typeId)
  return {
    id: related.id,
    reference: related.applicationReference || EM_DASH,
    site: siteLabel(related),
    type: type?.displayName ?? related.typeId ?? EM_DASH,
    charge:
      related.chargePence > 0
        ? formatChargeAmount(related.chargePence)
        : EM_DASH,
    status: stateDisplayName(type, related.stateId),
    statusTagClass: stateTagClass(related.stateId)
  }
}

/** "Site name (ORS id)", as in the add-ORS case header title. */
function siteLabel({ siteName, orsId }) {
  const name = siteName || EM_DASH
  return orsId ? `${name} (${orsId})` : name
}

/**
 * The table's view model from management-be's page: the heading count, the
 * rows and the pagination, which is null for a single page.
 *
 * @param {object} args
 * @param {object} args.related management-be's `related-work-items` body
 * @param {string} args.basePath the tab's own path, for the page links
 */
export function buildRelatedRequests({ related, basePath }) {
  const { totalCount, page, pageSize } = related
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  return {
    totalCount,
    rows: related.items.map(relatedWorkItemRow),
    pagination: buildPagination({ basePath, page, totalPages })
  }
}

/**
 * A govukPagination structure, or null when there is one page (AC2). The
 * page-1 link has no `page=`, so it is the tab's own URL.
 */
function buildPagination({ basePath, page, totalPages }) {
  if (totalPages <= 1) {
    return null
  }
  const href = (target) =>
    target > 1 ? `${basePath}?page=${target}` : basePath
  const items = []
  for (let number = 1; number <= totalPages; number++) {
    items.push({ number, href: href(number), current: number === page })
  }
  return {
    previous: page > 1 ? { href: href(page - 1) } : null,
    next: page < totalPages ? { href: href(page + 1) } : null,
    items
  }
}

/**
 * The page asked for in the query: a whole number from 1, or 1. management-be
 * answers a page past the end with the last page.
 */
export function requestedPage(raw) {
  const page = Number.parseInt(raw, 10)
  return Number.isInteger(page) && page >= 1 ? page : 1
}
