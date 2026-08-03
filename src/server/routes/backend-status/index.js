import { backendStatusController } from './controller.js'
import { requireSupportReadonly } from '#/server/common/helpers/auth/auth-scopes.js'

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
          // Diagnostic / monitoring endpoint, parallel to /health: it
          // reports whether this BFF can reach the backend's /health
          // endpoint. RA-335: restricted to signed-in support users — a
          // regulator or a signed-out visitor is not this page's audience.
          options: requireSupportReadonly,
          ...backendStatusController
        }
      ])
    }
  }
}
