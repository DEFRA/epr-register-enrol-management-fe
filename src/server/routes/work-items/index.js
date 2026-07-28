import { workItemListController } from './controller.js'
import { workItemDownloadFileController } from './download-file.controller.js'
import {
  makeShowAssignController,
  makeShowUnassignController
} from './assign.controller.js'
import {
  makeApplyActionController,
  makeAssignController,
  makeCompleteTaskController,
  makeSelfAssignController,
  makeSetTaskStatusController,
  makeUnassignController,
  workItemDetailController
} from './detail.controller.js'
import { workItemAuditLogController } from './audit-log.controller.js'
import { workItemTasksController } from './tasks.controller.js'
import {
  makeShowExtendController,
  makeSubmitExtendController,
  makeShowOverrideController,
  makeSubmitOverrideController
} from './sla.controller.js'
import {
  makeShowWithdrawController,
  makeSubmitWithdrawController
} from './withdraw.controller.js'
import {
  makeShowQueryController,
  makeSubmitQueryController
} from './query.controller.js'
import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

/**
 * Routes for the cross-type work item list (RA-93) plus the detail view,
 * task progression, action endpoints (RA-94) and assignment (RA-95). All
 * forms submit via plain GET/POST so the page works with no JavaScript in
 * the browser. The action POSTs use a redirect-after-post pattern so
 * refresh is harmless.
 *
 * Authorization: RA-323 — every caseworker holds the same role, so these
 * routes only require an authenticated session (`requireStandard`).
 */
export const workItems = {
  plugin: {
    name: 'work-items-routes',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/work-items',
          ...workItemListController
        },
        {
          method: 'GET',
          path: '/work-items/{id}',
          ...workItemDetailController
        },
        {
          // RA-295 AC02. The two-step application-details page is gone: all
          // submitted application data now renders on the detail page. The
          // route is kept as a redirect rather than deleted so bookmarks,
          // emailed links and any external reference resolve to the page
          // that now holds the data, instead of 404ing.
          //
          // Deliberately a 302, NOT a 301: browsers cache permanent
          // redirects aggressively and indefinitely, so a 301 would strand
          // every caseworker who followed the link once if this route ever
          // needs to come back or point elsewhere — with no server-side
          // remedy. A 302 resolves bookmarks just as well at a fraction of
          // the cost of being wrong.
          method: 'GET',
          path: '/work-items/{id}/application-details',
          handler(request, h) {
            return h.redirect(
              `/work-items/${encodeURIComponent(request.params.id)}`
            )
          }
        },
        {
          // Sampling-plan file download — direct S3 stream-through, gated
          // on the same work-item tenancy check as application-details
          // (enforced by the backend via getWorkItem, not re-implemented here).
          method: 'GET',
          path: '/work-items/{id}/files/{fileId}/download',
          ...workItemDownloadFileController
        },
        {
          // RA-97. Standalone audit log page so the detail view stays
          // focused on current state, tasks and actions.
          method: 'GET',
          path: '/work-items/{id}/audit-log',
          ...workItemAuditLogController
        },
        {
          // RA-129. Dedicated tasks page; type-agnostic.
          method: 'GET',
          path: '/work-items/{id}/tasks',
          ...workItemTasksController
        },
        {
          method: 'POST',
          path: '/work-items/{id}/tasks/{taskId}/complete',
          ...makeCompleteTaskController()
        },
        {
          // epr-gl6: richer task lifecycle. The form posts a `status` field
          // matching the backend's `WorkItemTaskStatus` enum names
          // (`NotStarted` | `InProgress` | `Blocked` | `Completed`). The
          // controller forwards to `PUT /tasks/{taskId}/status` via the
          // service object.
          method: 'POST',
          path: '/work-items/{id}/tasks/{taskId}/status',
          ...makeSetTaskStatusController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/actions/{actionId}',
          ...makeApplyActionController()
        },
        {
          // RA-188. Interstitial confirmation page for withdraw actions.
          // The detail template swaps the inline POST form for a link to
          // this GET when it spots a withdraw action; the POST below
          // PRG-redirects on success.
          method: 'GET',
          path: '/work-items/{id}/actions/{actionId}/confirm',
          ...makeShowWithdrawController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/actions/{actionId}/confirm',
          ...makeSubmitWithdrawController()
        },
        {
          // RA-291. Query an application: the caseworker picks the areas
          // to unlock and gives a reason. The backend resolves the state
          // transition itself, so no action id is sent.
          method: 'GET',
          path: '/work-items/{id}/query',
          ...makeShowQueryController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/query',
          options: {
            payload: {
              parse: true,
              allow: 'application/x-www-form-urlencoded',
              maxBytes: 32 * 1024
            }
          },
          ...makeSubmitQueryController()
        },
        {
          // RA-295 AC03. Reassign / unassign are offered as LINKS in the
          // detail page's assignment panel, so each has a GET interstitial
          // that posts to the handlers below. Same pattern as withdraw
          // (RA-188) and query (RA-291).
          method: 'GET',
          path: '/work-items/{id}/assign',
          options: requireStandard,
          ...makeShowAssignController()
        },
        {
          method: 'GET',
          path: '/work-items/{id}/unassign',
          options: requireStandard,
          ...makeShowUnassignController()
        },
        {
          // RA-323: assign / re-assign / self-assign are available to any
          // authenticated caseworker.
          method: 'POST',
          path: '/work-items/{id}/assign',
          options: requireStandard,
          ...makeAssignController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/unassign',
          options: requireStandard,
          ...makeUnassignController()
        },
        {
          // RA-153. Self-assign: claim an unassigned work item for
          // yourself. The handler derives the assignee from the
          // authenticated session — the form carries no assigneeId /
          // assigneeName.
          method: 'POST',
          path: '/work-items/{id}/self-assign',
          options: requireStandard,
          ...makeSelfAssignController()
        },
        {
          // RA-131. Extend SLA clock — available to any caseworker.
          method: 'GET',
          path: '/work-items/{id}/sla/extend',
          options: requireStandard,
          ...makeShowExtendController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/sla/extend',
          options: {
            ...requireStandard,
            payload: {
              parse: true,
              allow: 'application/x-www-form-urlencoded',
              maxBytes: 10 * 1024
            }
          },
          ...makeSubmitExtendController()
        },
        {
          // RA-131. Override SLA clock — available to any caseworker.
          method: 'GET',
          path: '/work-items/{id}/sla/override',
          options: requireStandard,
          ...makeShowOverrideController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/sla/override',
          options: {
            ...requireStandard,
            payload: {
              parse: true,
              allow: 'application/x-www-form-urlencoded',
              maxBytes: 10 * 1024
            }
          },
          ...makeSubmitOverrideController()
        }
      ])
    }
  }
}
