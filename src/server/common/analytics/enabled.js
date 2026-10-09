import { config } from '#/config/config.js'

// The id ends up in the page and in the gtm.js address, so anything that isn't
// shaped like a container id (a leftover GA4 `G-` id, a typo) counts as unset.
const GTM_CONTAINER_ID = /^GTM-[A-Z0-9]+$/

const hasValidContainerId = () =>
  GTM_CONTAINER_ID.test(config.get('analytics.gtmContainerId'))

// Use this rather than reading `analytics.isEnabled` directly, so the banner,
// the cookies page, the tag and the CSP can't disagree about whether
// analytics is on.
export const isAnalyticsEnabled = () =>
  config.get('analytics.isEnabled') && hasValidContainerId()

export function logAnalyticsMisconfiguration(logger) {
  if (config.get('analytics.isEnabled') && !hasValidContainerId()) {
    logger.error(
      'ANALYTICS_ENABLED is true but ANALYTICS_GTM_CONTAINER_ID is not set to a GTM-XXXXXXX container id - analytics and the cookie banner are disabled'
    )
  }
}
