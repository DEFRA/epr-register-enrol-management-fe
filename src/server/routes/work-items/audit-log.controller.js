import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { decorateAuditLog } from '#/server/work-items/core/audit-log.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { buildCaseHeader, buildCaseTabs } from './case-header.js'

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

    const workItem = result.workItem
    const applicationRef = workItem.payload.applicationReference
    const type = getWorkItemType(workItem.typeId)
    const typeDisplayName = type?.displayName ?? workItem.typeId
    const stateDisplayName =
      type?.states?.find((s) => s.id === workItem.stateId)?.displayName ??
      workItem.stateId

    const workItemSnapshot = {
      orgId: workItem.payload?.applicationReference ?? null,
      typeDisplayName,
      stateDisplayName,
      submittedAt: workItem.submittedAt ?? null,
      submittedBy: workItem.submittedBy ?? null,
      lastModifiedAt: workItem.lastModifiedAt ?? null,
      assignedToName: workItem.assignedToName ?? workItem.assignedToId ?? null
    }

    return h.view(AUDIT_LOG_VIEW, {
      pageTitle: `Application history — ${applicationRef}`,
      // RA-295. The audit log is the "Application history" tab of the
      // individual work item page, so it carries the same case header and
      // the same tab strip as the summary tab. The header's own
      // "Applications" back link replaces the GOV.UK breadcrumbs.
      caseHeader: buildCaseHeader({
        workItem: {
          ...workItem,
          stateDisplayName,
          stateTagClass: stateTagClass(workItem.stateId)
        }
      }),
      caseTabs: buildCaseTabs({ workItemId: workItem.id, active: 'history' }),
      workItem: {
        id: workItem.id,
        applicationRef,
        typeDisplayName,
        auditLog: decorateAuditLog(workItem.auditLog, {
          payload: workItem.payload,
          workItemSnapshot
        })
      }
    })
  }
}
