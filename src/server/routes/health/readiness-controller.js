import { statusCodes } from '#/server/common/constants/status-codes.js'
import { findMissingRequiredConfig } from './required-config.js'

/**
 * Readiness endpoint — reports missing required config as 503, separate
 * from GET /health (which must stay a trivial always-up liveness check;
 * the platform's own healthcheck probe targets /health, not this route —
 * see Dockerfile). Body lists missing config keys by name only, never
 * values.
 */
export const readinessController = {
  handler(_request, h) {
    const missing = findMissingRequiredConfig()

    if (missing.length === 0) {
      return h.response({ status: 'Healthy', checks: [] }).code(statusCodes.ok)
    }

    return h
      .response({
        status: 'Unhealthy',
        checks: [
          {
            name: 'required-config',
            status: 'Unhealthy',
            description: `Missing required config: ${missing.join(', ')}`
          }
        ]
      })
      .code(statusCodes.serviceUnavailable)
  }
}
