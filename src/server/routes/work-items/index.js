import { workItemListController } from './controller.js'

/**
 * Routes for the cross-type work item list.
 *
 * The detailed list with filtering, search and pagination is delivered by RA-93;
 * RA-91 only requires that newly-submitted items become visible to caseworkers,
 * so this initial view is intentionally minimal.
 */
export const workItems = {
  plugin: {
    name: 'work-items-list',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/work-items',
          ...workItemListController
        }
      ])
    }
  }
}
