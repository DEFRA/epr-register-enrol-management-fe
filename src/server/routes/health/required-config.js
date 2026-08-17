import { config } from '#/config/config.js'

/**
 * Config values that are only validated (or not validated at all) at
 * request time today — a blank value doesn't crash the process the way
 * the boot-time guards in src/config/config.js do for e.g.
 * SESSION_COOKIE_PASSWORD or REDIS_HOST, it just fails silently on
 * first use. Surfaced here (GET /health/ready) rather than added as
 * more boot-time throws, so a missing value is visible without waiting
 * for a deploy to crash-loop the whole task.
 *
 * Returns the list of missing config keys (names only, never values).
 */
export function findMissingRequiredConfig() {
  const missing = []

  // BACKEND_API_URL: default targets local dev (localhost:8085). No boot
  // guard exists for it (unlike AUTH_CALLBACK_BASE_URL, which uses the
  // same "still the localhost default outside local" check) — a blank/
  // default value only surfaces when the first backend-api call fails.
  if (
    config.get('environment') !== 'local' &&
    config.get('backendApi.url') === 'http://localhost:8085'
  ) {
    missing.push('BACKEND_API_URL')
  }

  // ENTRA_TENANT_ID: hand-built into the Entra OAuth/token/JWKS URLs
  // (src/server/common/helpers/auth/providers/azure-entra-id.js). Not
  // guarded at boot the way clientId/clientSecret are. Only relevant
  // when stub auth is disabled.
  if (
    !config.get('auth.stubEnabled') &&
    !config.get('auth.azureEntraId.tenantId')
  ) {
    missing.push('ENTRA_TENANT_ID')
  }

  // BASIC_USER / BASIC_PASSWD: doc comment on auth.basicEnabled claims the
  // server "will refuse to start" if either is blank while basic auth is
  // enabled, but no such boot guard exists — only relevant when basic
  // auth is actually enabled.
  if (config.get('auth.basicEnabled')) {
    if (!config.get('auth.basicUsr')) {
      missing.push('BASIC_USER')
    }
    if (!config.get('auth.basicPasswd')) {
      missing.push('BASIC_PASSWD')
    }
  }

  return missing
}
