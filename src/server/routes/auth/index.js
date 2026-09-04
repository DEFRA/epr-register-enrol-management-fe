import { config } from '#/config/config.js'
import {
  regulatorLoginController,
  regulatorCallbackController,
  logoutController,
  loggedOutController
} from './controller.js'
import { dismissSessionNoticeController } from './session-notice/controller.js'
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

      server.route({
        method: 'GET',
        path: '/auth/logged-out',
        options: { auth: false },
        handler: loggedOutController
      })

      // RA-462: dismiss the concurrent-login notice. Auth required (it acts on
      // the caller's own session) and CSRF-protected like any other POST.
      server.route({
        method: 'POST',
        path: '/auth/session-notice/dismiss',
        handler: dismissSessionNoticeController
      })

      if (stubEnabled) {
        server.route({
          method: 'GET',
          path: '/auth/regulator/login',
          options: { auth: false },
          handler: (request, h) => {
            const rt = request.query.rt
            return h.redirect(
              `/auth/stub/login${rt ? `?rt=${encodeURIComponent(rt)}` : ''}`
            )
          }
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
