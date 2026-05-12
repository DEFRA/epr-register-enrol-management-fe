import { config } from '#/config/config.js'

/**
 * A GDS styled example home page controller.
 * Provided as an example, remove or modify as required.
 */
export const homeController = {
  handler(_request, h) {
    return h.view('home/index', {
      pageTitle: 'Home',
      heading: 'Home',
      // RA-127. Show the create-work-item link only when the demo flag is on.
      showCreateWorkItem: config.get('featureFlags.workItemCreationEnabled')
    })
  }
}
