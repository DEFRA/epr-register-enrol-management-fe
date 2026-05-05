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
          // Diagnostic / monitoring endpoint, parallel to /health: it
          // reports whether this BFF can reach the backend's /health
          // endpoint and exposes no per-user data. We deliberately leave
          // it open (auth: false) so platform operators can hit it
          // without provisioning a session, the same way they hit
          // /health. (epr-zld)
          options: { auth: false },
          ...backendStatusController
        }
      ])
    }
  }
}
