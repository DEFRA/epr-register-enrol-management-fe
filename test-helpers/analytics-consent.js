import {
  ANALYTICS_CONSENT_COOKIE,
  buildConsentRecord,
  parseConsentCookie,
  serialiseConsentRecord
} from '#/server/common/analytics/consent.js'

export function consentCookie(analytics, overrides = {}) {
  const record = { ...buildConsentRecord(analytics), ...overrides }
  return `${ANALYTICS_CONSENT_COOKIE}=${serialiseConsentRecord(record)}`
}

export function decodeConsentSetCookie(setCookieHeader) {
  const value = setCookieHeader.split(';')[0].split('=').slice(1).join('=')
  return parseConsentCookie(value)
}
