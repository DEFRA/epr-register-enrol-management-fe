import { caseHasTab } from '#/server/routes/work-items/case-header.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'

const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

/**
 * RA-434 self-review. Shared not-found / unavailable rendering for a failed
 * `getWorkItem` lookup, extracted out of `audit-log.controller.js` and
 * `additional-information.controller.js` — both standalone tab pages that
 * re-fetch a work item via the backend client and handled the two failure
 * cases with byte-for-byte identical blocks.
 *
 * `detail.controller.js` is deliberately NOT a caller: its `renderDetail`
 * bakes the same two cases into a larger function with different control
 * flow, so folding it in here was judged out of scope for this extraction.
 *
 * @returns the `h.view(...).code(...)` response, or `null` when `result.ok`
 * is `true` and the caller should continue rendering its own page.
 */
export function renderWorkItemFetchError({ h, result, id }) {
  if (result.ok === false && result.status === 404) {
    return renderWorkItemNotFound({ h, id })
  }

  if (!result.ok) {
    return h
      .view(UNAVAILABLE_VIEW, {
        pageTitle: 'Work item unavailable',
        heading: 'Work item unavailable',
        workItemId: id,
        error: result.error ?? `Backend returned ${result.status}`,
        breadcrumbs: [
          { text: 'Work items', href: '/work-items' },
          { text: 'Work item' }
        ]
      })
      .code(502)
  }

  return null
}

/**
 * RA-739 (df7.21). As {@link renderWorkItemFetchError}, for a tab page some
 * case types don't have (Additional information, Recycling operations): a
 * work item whose type's case has no such tab (add-ORS) 404s here exactly as
 * an unknown work item does, rather than rendering another type's page
 * around it.
 *
 * @param {object} args
 * @param {string} args.tab the page's tab key (see `caseHasTab`)
 * @returns the error response, or `null` when the caller should continue.
 */
export function renderFetchErrorUnlessCaseHasTab({ h, result, id, tab }) {
  const errorResponse = renderWorkItemFetchError({ h, result, id })
  if (errorResponse) {
    return errorResponse
  }
  return caseHasTab(getWorkItemType(result.workItem?.typeId), tab)
    ? null
    : renderWorkItemNotFound({ h, id })
}

function renderWorkItemNotFound({ h, id }) {
  return h
    .view(NOT_FOUND_VIEW, {
      pageTitle: 'Application not found',
      heading: 'Application not found',
      workItemId: id,
      breadcrumbs: [
        { text: 'Applications', href: '/work-items' },
        { text: 'Not found' }
      ]
    })
    .code(404)
}
