import { config } from '#/config/config.js'
import {
  regulatorLoginController,
  regulatorCallbackController,
  logoutController
} from './controller.js'
import { stubAuthRoutes } from './stub/index.js'

export const authRoutes = {
  plugin: {
    name: 'auth-routes',
    async register(server) {
      const stubEnabled = config.get('auth.stubEnabled') || config.get('isTest')

      server.route({
        method: 'GET',
        path: '/auth/logout',
        options: { auth: false },
        handler: logoutController
      })

      if (stubEnabled) {
        server.route({
          method: 'GET',
          path: '/auth/regulator/login',
          options: { auth: false },
          handler: (_request, h) => h.redirect('/auth/stub/login')
        })

        if (
          config.get('auth.azureEntraId.clientId') &&
          config.get('auth.azureEntraId.tenantId')
        ) {
          server.route([
            {
              method: 'GET',
              path: '/auth/regulator/entra-id',
              options: { auth: false },
              handler: regulatorLoginController
            },
            {
              method: 'GET',
              path: '/auth/regulator/callback',
              options: { auth: false },
              handler: regulatorCallbackController
            }
          ])
        }

        await server.register([stubAuthRoutes])
        return
      }

      server.route([
        {
          method: 'GET',
          path: '/auth/regulator/login',
          options: { auth: false },
          handler: regulatorLoginController
        },
        {
          method: 'GET',
          path: '/auth/regulator/callback',
          options: { auth: false },
          handler: regulatorCallbackController
        }
      ])
    }
  }
}
