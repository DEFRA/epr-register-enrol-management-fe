import { config } from '#/config/config.js'

import { authPlugin } from '../common/helpers/auth/auth-plugin.js'
import { stubAuthPlugin } from '../common/helpers/auth/stub-auth-plugin.js'

/**
 * Choose which auth plugin to register on the server.
 *
 * The stub provider auto-authenticates every request. It is allowed in any
 * environment where ENVIRONMENT !== 'prod' (enforced at boot in config.js).
 */
export function selectAuthPlugin() {
  if (config.get('auth.stubEnabled') || config.get('isTest')) {
    return stubAuthPlugin
  }
  return authPlugin
}
