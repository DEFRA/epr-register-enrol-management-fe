import { workItemListController } from './controller.js'
import {
  makeAddNoteController,
  makeApplyActionController,
  makeAssignController,
  makeCompleteTaskController,
  makeSelfAssignController,
  makeSetTaskStatusController,
  makeUnassignController,
  workItemDetailController
} from './detail.controller.js'
import { workItemAuditLogController } from './audit-log.controller.js'
import {
  makeAddTaskNoteController,
  workItemTasksController
} from './tasks.controller.js'
import {
  makeShowExtendController,
  makeSubmitExtendController,
  makeConfirmExtendController,
  makeShowOverrideController,
  makeSubmitOverrideController
} from './sla.controller.js'
import {
  requireAssign,
  requireStandard,
  requireTeamLeader
} from '#/server/common/helpers/auth/auth-scopes.js'

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
          // RA-129. Dedicated tasks & notes page; type-agnostic.
          method: 'GET',
          path: '/work-items/{id}/tasks',
          ...workItemTasksController
        },
        {
          // RA-129. Add a task-scoped note. Open to any authenticated user.
          method: 'POST',
          path: '/work-items/{id}/tasks/{taskId}/notes',
          ...makeAddTaskNoteController()
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
          // Assign / re-assign / self-assign. Gated declaratively at the
          // route level (RA-95): only `assign`-role users can reach the
          // handler. The backend enforces the same rule independently and
          // remains the source of truth.
          method: 'POST',
          path: '/work-items/{id}/assign',
          options: requireAssign,
          ...makeAssignController()
        },
        {
          // Unassign requires the assign role; gated declaratively at the
          // route level so Hapi returns 403 before the handler runs.
          method: 'POST',
          path: '/work-items/{id}/unassign',
          options: requireAssign,
          ...makeUnassignController()
        },
        {
          // RA-153. Self-assign: a standard-role user claims an unassigned
          // work item for themselves. Gated at `requireStandard` (assign
          // users also have the standard scope) so the obvious "Take this
          // work item" affordance never returns a 403. The handler derives
          // the assignee from the authenticated session — the form carries
          // no assigneeId / assigneeName.
          method: 'POST',
          path: '/work-items/{id}/self-assign',
          options: requireStandard,
          ...makeSelfAssignController()
        },
        {
          // Add a note (RA-96). Open to any authenticated user; the backend
          // snapshots the acting user's identity onto the note.
          method: 'POST',
          path: '/work-items/{id}/notes',
          ...makeAddNoteController()
        },
        {
          // RA-131. Extend SLA clock. Gated to team-leader at both FE route
          // and controller level. BE independently enforces the role.
          method: 'GET',
          path: '/work-items/{id}/sla/extend',
          options: requireTeamLeader,
          ...makeShowExtendController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/sla/extend',
          options: {
            ...requireTeamLeader,
            payload: {
              parse: true,
              allow: 'application/x-www-form-urlencoded',
              maxBytes: 10 * 1024
            }
          },
          ...makeSubmitExtendController()
        },
        {
          // RA-131. Two-step extend flow: this is the "confirm" step that
          // actually applies the change. The first POST renders a review
          // page; this one forwards to the backend.
          method: 'POST',
          path: '/work-items/{id}/sla/extend/confirm',
          options: {
            ...requireTeamLeader,
            payload: {
              parse: true,
              allow: 'application/x-www-form-urlencoded',
              maxBytes: 10 * 1024
            }
          },
          ...makeConfirmExtendController()
        },
        {
          // RA-131. Override SLA clock. Gated to team-leader.
          method: 'GET',
          path: '/work-items/{id}/sla/override',
          options: requireTeamLeader,
          ...makeShowOverrideController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/sla/override',
          options: {
            ...requireTeamLeader,
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
