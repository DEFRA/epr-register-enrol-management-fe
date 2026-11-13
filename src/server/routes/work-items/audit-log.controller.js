import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { decorateAuditLog } from '#/server/work-items/core/audit-log.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import {
  buildCaseHeader,
  buildCaseTabs,
  decorateForCaseHeader,
  resolveOrganisationId,
  stateDisplayName
} from './case-header.js'
import { renderWorkItemFetchError } from './work-item-fetch-errors.js'

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

    const errorResponse = renderWorkItemFetchError({ h, result, id })
    if (errorResponse) {
      return errorResponse
    }

    const workItem = result.workItem
    const applicationRef = workItem.payload.applicationReference
    const forHeader = decorateForCaseHeader(workItem)
    const { typeDisplayName } = forHeader
    // The header's own state-name lookup, applied to each audit entry's own
    // `stateId` (epr-rr9s), so historical entries render their state as-of
    // the event rather than the current one.
    const type = getWorkItemType(workItem.typeId)
    const resolveStateDisplayName = (stateId) => stateDisplayName(type, stateId)

    const workItemSnapshot = {
      // RA-503: operatorOrganisationId is ReEx's internal ObjectId for a real operator
      // submission — never safe to show. resolveOrganisationId prefers operatorOrgNumber and
      // only falls back to operatorOrganisationId when it is itself genuinely 6-digit numeric
      // (an admin-created work item). See case-header.js.
      orgId: resolveOrganisationId(workItem.payload ?? {}),
      typeDisplayName,
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
      // RA-739. The header and tabs come from the work item's type, so an
      // add-ORS item gets its own here too.
      caseHeader: buildCaseHeader({ workItem: forHeader }),
      caseTabs: buildCaseTabs({
        workItemId: workItem.id,
        active: 'history',
        typeId: forHeader.typeId
      }),
      workItem: {
        id: workItem.id,
        applicationRef,
        typeDisplayName,
        auditLog: decorateAuditLog(workItem.auditLog, {
          payload: workItem.payload,
          workItemSnapshot,
          resolveStateDisplayName
        })
      }
    })
  }
}
