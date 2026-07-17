import Boom from '@hapi/boom'

import { config } from '#/config/config.js'
import { redirectToLogin } from './auth-redirect.js'
import {
  ROLE_NATION_ENGLAND,
  ROLE_NATION_SCOTLAND,
  ROLE_NATION_WALES,
  ROLE_NATION_NORTHERN_IRELAND,
  ROLE_STANDARD
} from './auth-scopes.js'

export const TEST_STANDARD_USER = {
  id: 'test-standard-id',
  email: 'standard@test.example',
  name: 'Test Standard User',
  roles: [ROLE_STANDARD],
  scope: [ROLE_STANDARD]
}

export const TEST_NATION_ENGLAND_USER = {
  id: 'test-nation-england-id',
  email: 'england@test.example',
  name: 'Test England User',
  roles: [ROLE_STANDARD, ROLE_NATION_ENGLAND],
  scope: [ROLE_STANDARD, ROLE_NATION_ENGLAND]
}

export const TEST_NATION_SCOTLAND_USER = {
  id: 'test-nation-scotland-id',
  email: 'scotland@test.example',
  name: 'Test Scotland User',
  roles: [ROLE_STANDARD, ROLE_NATION_SCOTLAND],
  scope: [ROLE_STANDARD, ROLE_NATION_SCOTLAND]
}

export const TEST_NATION_WALES_USER = {
  id: 'test-nation-wales-id',
  email: 'wales@test.example',
  name: 'Test Wales User',
  roles: [ROLE_STANDARD, ROLE_NATION_WALES],
  scope: [ROLE_STANDARD, ROLE_NATION_WALES]
}

export const TEST_NATION_NORTHERN_IRELAND_USER = {
  id: 'test-nation-northern-ireland-id',
  email: 'northern-ireland@test.example',
  name: 'Test Northern Ireland User',
  roles: [ROLE_STANDARD, ROLE_NATION_NORTHERN_IRELAND],
  scope: [ROLE_STANDARD, ROLE_NATION_NORTHERN_IRELAND]
}

const TEST_USERS = {
  standard: TEST_STANDARD_USER,
  'nation-england': TEST_NATION_ENGLAND_USER,
  'nation-scotland': TEST_NATION_SCOTLAND_USER,
  'nation-wales': TEST_NATION_WALES_USER,
  'nation-northern-ireland': TEST_NATION_NORTHERN_IRELAND_USER
}

/**
 * Stub auth plugin used in development and tests.
 *
 * - In `NODE_ENV=test`, every request is auto-authenticated as the single
 *   caseworker identity (RA-323: every caseworker holds the same role).
 *   Tests can override the nation via the `x-test-user-role` header (e.g.
 *   'nation-england') to exercise the RA-125 nation-default filter.
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
            // Default (header omitted) is the standard caseworker. If the
            // header is explicitly set, only the documented values are
            // accepted — unknown values must fail loudly rather than
            // silently falling back and masking test bugs.
            if (headerRole !== undefined && !(headerRole in TEST_USERS)) {
              return h.unauthenticated(
                Boom.badRequest(
                  `Invalid x-test-user-role '${headerRole}'. Expected one of: ${Object.keys(TEST_USERS).join(', ')}.`
                )
              )
            }
            const user = TEST_USERS[headerRole] ?? TEST_STANDARD_USER
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
