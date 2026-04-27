import Boom from '@hapi/boom'

import { redirectToLogin } from './auth-redirect.js'

/**
 * Production auth plugin.
 *
 * Defines a custom 'yar-session' scheme that reads the authenticated user
 * from the server-side yar session (populated by the OAuth callback). The
 * scheme is set as the default so every route requires a valid session
 * unless it opts out with `auth: false`.
 */
export const authPlugin = {
  plugin: {
    name: 'auth',
    async register(server) {
      server.auth.scheme('yar-session', () => ({
        authenticate(request, h) {
          const user = request.yar.get('user')
          if (!user) {
            return h.unauthenticated(Boom.unauthorized(null, 'session'))
          }
          return h.authenticated({
            credentials: { ...user, scope: user.roles ?? [] }
          })
        }
      }))

      server.auth.strategy('session', 'yar-session')
      server.auth.default('session')

      server.ext('onPreResponse', redirectToLogin)
    }
  }
}
