import { workItemListController } from './controller.js'
import {
  makeAddNoteController,
  makeApplyActionController,
  makeAssignController,
  makeCompleteTaskController,
  makeUnassignController,
  workItemDetailController
} from './detail.controller.js'
import { workItemAuditLogController } from './audit-log.controller.js'

/**
 * Routes for the cross-type work item list (RA-93) plus the detail view,
 * task progression, action endpoints (RA-94) and assignment (RA-95). All
 * forms submit via plain GET/POST so the page works with no JavaScript in
 * the browser. The action POSTs use a redirect-after-post pattern so
 * refresh is harmless.
 *
 * Authorization: assignment writes are deliberately gated *server-side*.
 * Backend enforcement is the source of truth (the role headers it reads
 * are the BFF's; it does not trust client-supplied roles), but the BFF
 * also fails fast for the obvious case so a standard user never sees a
 * 403 from a bad UI affordance.
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
          // RA-97. Standalone audit log page so the detail view stays
          // focused on current state, tasks and actions.
          method: 'GET',
          path: '/work-items/{id}/audit-log',
          ...workItemAuditLogController
        },
        {
          method: 'POST',
          path: '/work-items/{id}/tasks/{taskId}/complete',
          ...makeCompleteTaskController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/actions/{actionId}',
          ...makeApplyActionController()
        },
        {
          // Assign / re-assign / self-assign. Open to any authenticated
          // user; the backend rejects writes the caller is not allowed to
          // make (e.g. a standard user assigning to someone else).
          method: 'POST',
          path: '/work-items/{id}/assign',
          ...makeAssignController()
        },
        {
          // Unassign requires the assign role on the backend. Surfacing the
          // 403 inline (via the controller's error notice path) keeps the
          // UX consistent with all the other action errors.
          method: 'POST',
          path: '/work-items/{id}/unassign',
          ...makeUnassignController()
        },
        {
          // Add a note (RA-96). Open to any authenticated user; the backend
          // snapshots the acting user's identity onto the note.
          method: 'POST',
          path: '/work-items/{id}/notes',
          ...makeAddNoteController()
        }
      ])
    }
  }
}
