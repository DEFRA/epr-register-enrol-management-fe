import { workItemListController } from './controller.js'

/**
 * Routes for the cross-type work item list with filter, search and
 * pagination (RA-93). All filters are submitted via plain GET so the page
 * works with no JavaScript in the browser.
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
