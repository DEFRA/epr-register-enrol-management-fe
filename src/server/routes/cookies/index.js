import { config } from '#/config/config.js'
import { ANALYTICS_CONSENT_COOKIE } from '#/server/common/analytics/consent.js'
import { takeConsentConfirmationForView } from '#/server/common/analytics/confirmation.js'
import { cookiesController } from './controller.js'
import { consentController } from './consent-controller.js'

const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

// Reachable signed out, but `try` still loads a signed-in session so the
// navigation and Sign out link render as normal.
const signedInOrOut = { auth: { mode: 'try' } }

export const cookies = {
  plugin: {
    name: 'cookies',
    register(server) {
      server.state(ANALYTICS_CONSENT_COOKIE, {
        ttl: CONSENT_MAX_AGE_MS,
        path: '/',
        isSecure: config.get('session.cookie.secure'),
        isHttpOnly: true,
        isSameSite: 'Lax',
        encoding: 'base64json',
        // A value that won't decode is dropped rather than failing the
        // request, so the visitor is simply asked again.
        clearInvalid: true,
        ignoreErrors: true
      })

      server.ext('onPreResponse', takeConsentConfirmationForView, {
        before: ['@hapi/yar']
      })

      server.route([
        {
          method: 'GET',
          path: '/cookies',
          options: signedInOrOut,
          ...cookiesController
        },
        {
          method: 'POST',
          path: '/cookies/consent',
          ...consentController,
          options: { ...consentController.options, ...signedInOrOut }
        }
      ])
    }
  }
}
