import crypto from 'crypto'

import { config } from '#/config/config.js'

// Prevents timing attacks where a naive string comparison (===) returns faster
// for an early mismatch, leaking credential length/content via response time.
function safeCompare(a, b) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)
}

// Frozen so no import site can accidentally push to this array and widen the bypass.
export const basicAuthExcludedPaths = Object.freeze([
  '/health',
  '/favicon.ico',
  '/auth/regulator/callback'
])

// Prefix-based exclusions — any path starting with one of these bypasses basic auth.
// /public/ must be open so browsers can load static assets before the OIDC login
// redirects the user, and so the IdP callback redirect is not blocked.
export const basicAuthExcludedPrefixes = Object.freeze(['/public/'])

// Not exported — internal to this module. Tests assert the value via HTTP response headers.
const WWW_AUTHENTICATE = 'Basic realm="Secure"'

export const basicAuthPlugin = {
  plugin: {
    name: 'basicAuth',
    async register(server) {
      if (!config.get('auth.basicEnabled')) {
        return
      }

      const validUsername = config.get('auth.basicUsr')
      const validPassword = config.get('auth.basicPasswd')

      if (!validUsername || !validPassword) {
        throw new Error(
          'Basic auth enabled but username or password not set in config'
        )
      }

      server.ext('onPreAuth', (request, h) => {
        if (
          basicAuthExcludedPaths.includes(request.path) ||
          basicAuthExcludedPrefixes.some((prefix) =>
            request.path.startsWith(prefix)
          )
        ) {
          return h.continue
        }

        const authHeader = request.headers.authorization
        if (!authHeader?.startsWith('Basic ')) {
          return h
            .response()
            .code(401)
            .header('WWW-Authenticate', WWW_AUTHENTICATE)
            .takeover()
        }

        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString()
        const colonIndex = decoded.indexOf(':')

        // A missing colon means the credential is malformed — reject immediately
        // rather than falling through to safeCompare with an empty password.
        if (colonIndex === -1) {
          return h
            .response()
            .code(401)
            .header('WWW-Authenticate', WWW_AUTHENTICATE)
            .takeover()
        }

        const username = decoded.slice(0, colonIndex)
        const password = decoded.slice(colonIndex + 1)

        // Both comparisons run unconditionally so neither branch leaks timing
        // information about whether the username alone was correct.
        const usernameMatch = safeCompare(username, validUsername)
        const passwordMatch = safeCompare(password, validPassword)
        if (!usernameMatch || !passwordMatch) {
          return h
            .response()
            .code(401)
            .header('WWW-Authenticate', WWW_AUTHENTICATE)
            .takeover()
        }

        return h.continue
      })
    }
  }
}
