import { config } from '#/config/config.js'

import { authPlugin } from '../common/helpers/auth/auth-plugin.js'
import { stubAuthPlugin } from '../common/helpers/auth/stub-auth-plugin.js'

/**
 * Choose which auth plugin to register on the server.
 *
 * The stub provider auto-authenticates every request and must never be
 * mounted in production. The production guard in `config.js` separately
 * enforces that `auth.stubEnabled` cannot be true when `isProduction` is
 * true, so this helper is belt-and-braces — it will never select the
 * stub when `isProduction` is true, even if `auth.stubEnabled` were
 * somehow true. Note `isProduction` is the strict flag (NODE_ENV=production
 * AND ENVIRONMENT=prod), so the stub remains available in CDP dev/test.
 */
export function selectAuthPlugin() {
  if (config.get('isProduction')) {
    return authPlugin
  }
  if (config.get('auth.stubEnabled') || config.get('isTest')) {
    return stubAuthPlugin
  }
  return authPlugin
}
