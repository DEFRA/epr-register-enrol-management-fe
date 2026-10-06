import {
  ANALYTICS_CONSENT_COOKIE,
  buildConsentRecord
} from '#/server/common/analytics/consent.js'

// The cookie uses hapi's `base64json` encoding.
export function encodeConsentValue(record) {
  return Buffer.from(JSON.stringify(record)).toString('base64')
}

export function decodeConsentValue(value) {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8'))
}

export function consentCookie(analytics, overrides = {}) {
  const record = { ...buildConsentRecord(analytics), ...overrides }
  return `${ANALYTICS_CONSENT_COOKIE}=${encodeConsentValue(record)}`
}

export function decodeConsentSetCookie(setCookieHeader) {
  const value = setCookieHeader.split(';')[0].split('=').slice(1).join('=')
  return decodeConsentValue(value)
}
