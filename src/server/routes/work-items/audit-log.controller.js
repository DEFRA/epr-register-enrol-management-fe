import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { decorateAuditLog } from '#/server/work-items/core/audit-log.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'

const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'
const AUDIT_LOG_VIEW = 'work-items/audit-log'

/**
 * Render the standalone audit log page for a work item (RA-97).
 *
 * The audit log lives on its own page so the detail view stays focused on
 * the work item's current state, tasks and actions. We re-fetch the work
 * item via the backend client so the timeline is always up to date with
 * the latest engine projection.
 */
export const workItemAuditLogController = {
  async handler(request, h) {
    const id = request.params.id
    const user = getUser(request)
    const result = await getWorkItem({ workItemId: id, user })

    if (result.ok === false && result.status === 404) {
      return h
        .view(NOT_FOUND_VIEW, {
          pageTitle: 'Work item not found',
          heading: 'Work item not found',
          workItemId: id,
          breadcrumbs: [
            { text: 'Home', href: '/' },
            { text: 'Work items', href: '/work-items' },
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
            { text: 'Home', href: '/' },
            { text: 'Work items', href: '/work-items' },
            { text: id }
          ]
        })
        .code(502)
    }

    const workItem = result.workItem
    const type = getWorkItemType(workItem.typeId)
    const typeDisplayName = type?.displayName ?? workItem.typeId
    const stateDisplayName =
      type?.states?.find((state) => state.id === workItem.stateId)
        ?.displayName ?? workItem.stateId

    return h.view(AUDIT_LOG_VIEW, {
      pageTitle: `Audit log — work item ${workItem.id}`,
      heading: 'Audit log',
      breadcrumbs: [
        { text: 'Home', href: '/' },
        { text: 'Work items', href: '/work-items' },
        {
          text: workItem.id,
          href: `/work-items/${encodeURIComponent(workItem.id)}`
        },
        { text: 'Audit log' }
      ],
      workItem: {
        id: workItem.id,
        typeDisplayName,
        stateDisplayName,
        submittedAt: workItem.submittedAt ?? null,
        submittedBy: workItem.submittedBy ?? null,
        lastModifiedAt: workItem.lastModifiedAt ?? null,
        assigneeDisplayName:
          workItem.assignedToName ?? workItem.assignedToId ?? null,
        auditLog: decorateAuditLog(workItem.auditLog, {
          payload: workItem.payload
        })
      }
    })
  }
}
