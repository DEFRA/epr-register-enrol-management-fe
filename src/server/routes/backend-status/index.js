import { backendStatusController } from './controller.js'

/**
 * Sets up the routes used in the /backend-status page.
 * These routes are registered in src/server/router.js.
 */
export const backendStatus = {
  plugin: {
    name: 'backend-status',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/backend-status',
          ...backendStatusController
        }
      ])
    }
  }
}
