// gtm.js, and the gtag.js a GA4 tag in the container pulls in, both load from
// googletagmanager.com and send data back to it, as fetches and as image
// beacons (the container's diagnostics ping, /a?id=...), hence script, connect
// and img.
export const analyticsOrigins = Object.freeze({
  connect: [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://www.googletagmanager.com'
  ],
  img: ['https://*.google-analytics.com', 'https://www.googletagmanager.com'],
  script: ['https://www.googletagmanager.com']
})
