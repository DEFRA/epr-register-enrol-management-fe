import { config } from '#/config/config.js'

// Use this rather than reading `analytics.isEnabled` directly, so the banner,
// the cookies page and the CSP can't disagree about whether analytics is on.
export const isAnalyticsEnabled = () =>
  config.get('analytics.isEnabled') &&
  Boolean(config.get('analytics.measurementId'))

export function logAnalyticsMisconfiguration(logger) {
  if (
    config.get('analytics.isEnabled') &&
    !config.get('analytics.measurementId')
  ) {
    logger.error(
      'ANALYTICS_ENABLED is true but ANALYTICS_MEASUREMENT_ID is not set - analytics and the cookie banner are disabled'
    )
  }
}
