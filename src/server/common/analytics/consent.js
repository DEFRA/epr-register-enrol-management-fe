import { isAnalyticsEnabled } from './enabled.js'

// Same cookie name and answer values as ReEx (epr-frontend), but ReEx stores a
// bare string, not this record - the two can't share a choice until they match.
export const ANALYTICS_CONSENT_COOKIE = 'analyticsConsent'

export const ANALYTICS_CONSENT = Object.freeze({
  accepted: 'accepted',
  rejected: 'rejected'
})

// Increment when the cookie policy changes enough that everyone should be
// asked again - answers to any other version count as no answer.
export const ANALYTICS_CONSENT_VERSION = 1

export function buildConsentRecord(analytics, now = new Date()) {
  return {
    analytics,
    version: ANALYTICS_CONSENT_VERSION,
    decidedAt: now.toISOString()
  }
}

// Raw JSON so the cookie is readable in browser dev tools. Quotes and commas
// fall outside RFC 6265's cookie-value characters, which is why the cookie is
// declared with `strictHeader: false`.
export function serialiseConsentRecord(record) {
  return JSON.stringify(record)
}

export function parseConsentCookie(value) {
  if (typeof value !== 'string') {
    return null
  }
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function readConsent(request) {
  const record = parseConsentCookie(request?.state?.[ANALYTICS_CONSENT_COOKIE])

  if (record?.version !== ANALYTICS_CONSENT_VERSION) {
    return null
  }

  return record.analytics === ANALYTICS_CONSENT.accepted ||
    record.analytics === ANALYTICS_CONSENT.rejected
    ? record.analytics
    : null
}

/**
 * `hasRejected` is not the negation of `hasConsented`: a visitor who has not
 * answered has neither. `returnUrl` is built from the request, never taken
 * from the browser, so it is always a local path.
 * @param {import('@hapi/hapi').Request | null} request
 */
export function analyticsConsent(request) {
  const returnUrl = request?.url
    ? `${request.url.pathname}${request.url.search}`
    : '/'

  if (!isAnalyticsEnabled()) {
    return {
      hasConsented: false,
      hasRejected: false,
      isEnabled: false,
      returnUrl,
      shouldAskConsent: false
    }
  }

  const consent = readConsent(request)

  return {
    hasConsented: consent === ANALYTICS_CONSENT.accepted,
    hasRejected: consent === ANALYTICS_CONSENT.rejected,
    isEnabled: true,
    returnUrl,
    shouldAskConsent: consent === null
  }
}
