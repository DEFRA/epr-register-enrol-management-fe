import { healthController } from './controller.js'
import { readinessController } from './readiness-controller.js'

export const health = {
  plugin: {
    name: 'health',
    register(server) {
      server.route({
        method: 'GET',
        path: '/health',
        options: { auth: false },
        ...healthController
      })

      // Separate from /health: reports missing required config as 503
      // instead of the platform liveness probe crash-looping the whole
      // task over an app-config gap it can't fix by restarting.
      server.route({
        method: 'GET',
        path: '/health/ready',
        options: { auth: false },
        ...readinessController
      })
    }
  }
}
