import yar from '@hapi/yar'

import { config } from '#/config/config.js'

const sessionConfig = config.get('session')

/**
 * Set options.maxCookieSize to 0 to always use server-side storage
 */
export const sessionCache = {
  plugin: yar,
  options: {
    name: sessionConfig.cache.name,
    cache: {
      cache: sessionConfig.cache.name,
      expiresIn: sessionConfig.cache.ttl
    },
    storeBlank: false,
    errorOnCacheNotReady: true,
    cookieOptions: {
      password: sessionConfig.cookie.password,
      ttl: sessionConfig.cookie.ttl,
      isSecure: config.get('session.cookie.secure'),
      isHttpOnly: true,
      // Lax is required because the regulator OAuth callback is a
      // cross-site 302 from Microsoft and the session cookie must be
      // sent on that top-level navigation.
      isSameSite: 'Lax',
      clearInvalid: true
    }
  }
}
