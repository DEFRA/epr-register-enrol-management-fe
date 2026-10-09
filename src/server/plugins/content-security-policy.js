import Blankie from 'blankie'

import { isAnalyticsEnabled } from '../common/analytics/enabled.js'
import { analyticsOrigins } from '../common/analytics/origins.js'

// Supports a GOV.UK frontend script bundled within Nunjucks macros
// https://frontend.design-system.service.gov.uk/import-javascript/#if-our-inline-javascript-snippet-is-blocked-by-a-content-security-policy
const govukInlineScriptHash =
  "'sha256-GUQ5ad8JK5KmEWmROf3LZd9ge94daqNvd8xy9YS1iDw='"

/**
 * Analytics widens connect, script and img sources only - enough for the Tag
 * Manager container and the GA4 tag in it. frameSrc and nonces stay closed, so
 * GTM's noscript iframe and any Custom HTML tag added to the container are
 * blocked: a tag of that kind needs a change here, not just in GTM.
 * @param {{ allowAnalytics: boolean }} options
 */
export const cspOptions = ({ allowAnalytics }) => ({
  defaultSrc: ['self'],
  fontSrc: ['self', 'data:'],
  connectSrc: [
    'self',
    'wss:',
    'data:',
    ...(allowAnalytics ? analyticsOrigins.connect : [])
  ],
  mediaSrc: ['self'],
  styleSrc: ['self'],
  scriptSrc: [
    'self',
    govukInlineScriptHash,
    ...(allowAnalytics ? analyticsOrigins.script : [])
  ],
  imgSrc: ['self', 'data:', ...(allowAnalytics ? analyticsOrigins.img : [])],
  frameSrc: ['self', 'data:'],
  objectSrc: ['none'],
  frameAncestors: ['none'],
  formAction: ['self'],
  manifestSrc: ['self'],
  generateNonces: false
})

/**
 * Manage content security policies.
 *
 * `options` is a getter so the policy reflects config at the point the server
 * registers the plugin, not when this module is first imported.
 * @satisfies {import('@hapi/hapi').Plugin}
 */
const contentSecurityPolicy = {
  plugin: Blankie,
  get options() {
    return cspOptions({ allowAnalytics: isAnalyticsEnabled() })
  }
}

export { contentSecurityPolicy }
