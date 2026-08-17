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
