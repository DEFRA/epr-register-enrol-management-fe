const TAG_MANAGER = 'https://www.googletagmanager.com'
const GOOGLE_ANALYTICS = 'https://*.google-analytics.com'
const GOOGLE_ANALYTICS_REGIONAL = 'https://*.analytics.google.com'

// gtm.js, and the gtag.js a GA4 tag in the container pulls in, both load from
// googletagmanager.com and send data back to it, as fetches and as image
// beacons (the container's diagnostics ping, /a?id=...), hence script, connect
// and img.
export const analyticsOrigins = Object.freeze({
  connect: [GOOGLE_ANALYTICS, GOOGLE_ANALYTICS_REGIONAL, TAG_MANAGER],
  img: [GOOGLE_ANALYTICS, TAG_MANAGER],
  script: [TAG_MANAGER]
})
