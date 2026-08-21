import { workItemListController } from './controller.js'
import { workItemDownloadFileController } from './download-file.controller.js'
import {
  makeShowAssignController,
  makeShowUnassignController
} from './assign.controller.js'
import {
  makeApplyActionController,
  makeAssignController,
  makeSelfAssignController,
  makeUnassignController,
  workItemDetailController
} from './detail.controller.js'
import { workItemAuditLogController } from './audit-log.controller.js'
import { workItemRecyclingOperationsController } from './recycling-operations.controller.js'
import { workItemAdditionalInformationController } from './additional-information.controller.js'
import {
  makeShowExtendController,
  makeSubmitExtendController,
  makeShowOverrideController,
  makeSubmitOverrideController
} from './sla.controller.js'
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
 * Authorization: RA-323 — every caseworker holds the same role, so GET
 * routes only require an authenticated session. RA-335 — every mutating
 * POST route requires `requireStandard` specifically, not just any
 * authenticated session, so a signed-in read-only support user's session
 * (which never holds `ROLE_STANDARD`) is rejected server-side even if a
 * disabled UI button is bypassed by a crafted request.
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
          // RA-469. Standalone "Recycling operations" tab page, same
          // pattern as the audit log (RA-97) and additional information
          // (RA-434) tabs: a real, bookmarkable, JS-free page. Any
          // authenticated caseworker (including support-readonly) may
          // view it — only the edit form (RA-469 8pi) requires
          // requireStandard.
          method: 'GET',
          path: '/work-items/{id}/recycling-operations',
          ...workItemRecyclingOperationsController
        },
        {
          // RA-434. Standalone "Additional information" tab page, same
          // pattern as the audit log (RA-97): each tab is its own
          // bookmarkable, JS-free page.
          method: 'GET',
          path: '/work-items/{id}/additional-information',
          ...workItemAdditionalInformationController
        },
        // RA-410. The tasks page and the two task-mutation POSTs
        // (`/tasks/{taskId}/complete`, `/tasks/{taskId}/status`) used to sit
        // here. They were deleted outright rather than kept as redirects. A
        // redirect is right for a page whose CONTENT moved (see
        // `/application-details` above); tasks did not move, the feature was
        // withdrawn — progress is now driven by the Duly make / Assign to
        // yourself and start / Log decision CTAs. Redirecting the two POSTs
        // would be actively wrong: a crafted request must fail, not silently
        // land on the detail page looking like it worked. All three now 404,
        // which is what AC03 asks for.
        {
          method: 'POST',
          path: '/work-items/{id}/actions/{actionId}',
          options: requireStandard,
          ...makeApplyActionController()
        },
        // RA-317. The withdraw confirmation interstitial (RA-188) GET/POST
        // `/actions/{actionId}/confirm` routes were REMOVED: withdraw is an
        // operator-only action and must not be reachable from Case
        // Management. They existed solely for the now-deleted CM withdraw
        // journey. The generic apply-action route above additionally rejects
        // any `withdraw`/`withdraw-*` action id server-side (see
        // makeApplyActionController), so a crafted POST cannot withdraw.
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
            ...requireStandard,
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
