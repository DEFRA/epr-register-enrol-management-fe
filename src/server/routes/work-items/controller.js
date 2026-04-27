import { getWorkItems } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'

/**
 * Renders the cross-type work item list.
 *
 * Fetches every persisted work item from the backend and decorates each with
 * its registered display name (so unknown types still render as their raw id).
 * The full filter/search/pagination experience belongs to RA-93; this view is
 * the minimum needed to satisfy RA-91's "submitted items are visible" AC.
 */
export const workItemListController = {
  async handler(_request, h) {
    const result = await getWorkItems()

    const items = result.ok
      ? result.items.map((item) => decorate(item))
      : []

    return h.view('work-items/index', {
      pageTitle: 'Work items',
      heading: 'Work items',
      breadcrumbs: [
        { text: 'Home', href: '/' },
        { text: 'Work items' }
      ],
      ok: result.ok,
      error: result.error,
      items
    })
  }
}

function decorate(item) {
  const type = getWorkItemType(item.typeId)
  const stateId = item.stateId
  const stateDisplayName =
    type?.states?.find((state) => state.id === stateId)?.displayName ?? stateId
  return {
    ...item,
    typeDisplayName: type?.displayName ?? item.typeId,
    stateDisplayName
  }
}
