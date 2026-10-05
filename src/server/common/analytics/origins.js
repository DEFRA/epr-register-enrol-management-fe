// The same GA4 origins ReEx (epr-frontend) allows. gtag.js loads from
// googletagmanager.com and also sends data back to it, hence script and connect.
export const analyticsOrigins = Object.freeze({
  connect: [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://www.googletagmanager.com'
  ],
  img: ['https://*.google-analytics.com'],
  script: ['https://www.googletagmanager.com']
})
