import Boom from '@hapi/boom'

import { config } from '#/config/config.js'
import { redirectToLogin } from './auth-redirect.js'
import { ROLE_ASSIGN, ROLE_DECISION_MAKER, ROLE_STANDARD } from './auth-scopes.js'

export const TEST_STANDARD_USER = {
  id: 'test-standard-id',
  email: 'standard@test.example',
  name: 'Test Standard User',
  roles: [ROLE_STANDARD],
  scope: [ROLE_STANDARD]
}

export const TEST_ASSIGN_USER = {
  id: 'test-assign-id',
  email: 'assign@test.example',
  name: 'Test Assign User',
  roles: [ROLE_STANDARD, ROLE_ASSIGN],
  scope: [ROLE_STANDARD, ROLE_ASSIGN]
}

export const TEST_DECISION_MAKER_USER = {
  id: 'test-decision-maker-id',
  email: 'decision-maker@test.example',
  name: 'Test Decision Maker',
  roles: [ROLE_STANDARD, ROLE_DECISION_MAKER],
  scope: [ROLE_STANDARD, ROLE_DECISION_MAKER]
}

const TEST_USERS = {
  standard: TEST_STANDARD_USER,
  assign: TEST_ASSIGN_USER,
  'decision-maker': TEST_DECISION_MAKER_USER
}

/**
 * Stub auth plugin used in development and tests.
 *
 * - In `NODE_ENV=test`, every request is auto-authenticated. Tests can
 *   override the user by setting the `x-test-user-role` header to either
 *   'standard' or 'assign' (defaults to 'assign' so tests have full access
 *   without needing to opt in).
 * - Otherwise (local dev), uses the same yar-session scheme as production.
 *   The stub login chooser populates the session.
 */
export const stubAuthPlugin = {
  plugin: {
    name: 'auth',
    async register(server) {
      if (config.get('isTest')) {
        server.auth.scheme('test-bypass', () => ({
          authenticate(request, h) {
            const headerRole = request.headers['x-test-user-role']
            // Default (header omitted) is the assign user so tests have
            // full access without needing to opt in. If the header is
            // explicitly set, only the documented values are accepted —
            // unknown values must fail loudly rather than silently
            // falling back and masking test bugs.
            if (headerRole !== undefined && !(headerRole in TEST_USERS)) {
              return h.unauthenticated(
                Boom.badRequest(
                  `Invalid x-test-user-role '${headerRole}'. Expected one of: ${Object.keys(TEST_USERS).join(', ')}.`
                )
              )
            }
            const user = TEST_USERS[headerRole] ?? TEST_ASSIGN_USER
            return h.authenticated({ credentials: user })
          }
        }))
        server.auth.strategy('session', 'test-bypass')
        server.auth.default('session')
        server.ext('onPreResponse', redirectToLogin)
        return
      }

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
