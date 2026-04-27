import { workItemListController } from './controller.js'
import {
  makeApplyActionController,
  makeCompleteTaskController,
  workItemDetailController
} from './detail.controller.js'

/**
 * Routes for the cross-type work item list (RA-93) plus the detail view,
 * task progression and action endpoints (RA-94). All forms submit via
 * plain GET/POST so the page works with no JavaScript in the browser. The
 * action POSTs use a redirect-after-post pattern so refresh is harmless.
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
          method: 'POST',
          path: '/work-items/{id}/tasks/{taskId}/complete',
          ...makeCompleteTaskController()
        },
        {
          method: 'POST',
          path: '/work-items/{id}/actions/{actionId}',
          ...makeApplyActionController()
        }
      ])
    }
  }
}
