import Joi from 'joi'

import { config } from '#/config/config.js'
import {
  ANALYTICS_CONSENT,
  ANALYTICS_CONSENT_COOKIE,
  buildConsentRecord,
  serialiseConsentRecord
} from '#/server/common/analytics/consent.js'
import { setConsentConfirmation } from '#/server/common/analytics/confirmation.js'

const isAnalyticsCookie = (name) => name === '_ga' || name.startsWith('_ga_')

// `//host` and `/\host` start with a slash but browsers treat them as off-site.
export function safeReturnUrl(returnUrl) {
  return typeof returnUrl === 'string' &&
    returnUrl.startsWith('/') &&
    !returnUrl.startsWith('//') &&
    !returnUrl.startsWith('/\\')
    ? returnUrl
    : '/'
}

export const consentController = {
  options: {
    validate: {
      payload: Joi.object({
        analytics: Joi.string()
          .valid(...Object.values(ANALYTICS_CONSENT))
          .required(),
        returnUrl: Joi.string().allow('').optional(),
        crumb: Joi.string().optional()
      })
    }
  },
  handler(request, h) {
    const { analytics, returnUrl } = request.payload

    setConsentConfirmation(request, analytics)

    const response = h
      .redirect(safeReturnUrl(returnUrl))
      .state(
        ANALYTICS_CONSENT_COOKIE,
        serialiseConsentRecord(buildConsentRecord(analytics))
      )

    // Only clears GA cookies set for this exact host: a cookie only expires
    // when its domain matches, and GA defaults to the parent domain.
    if (analytics === ANALYTICS_CONSENT.rejected) {
      for (const name of Object.keys(request.state ?? {})) {
        if (isAnalyticsCookie(name)) {
          response.unstate(name, {
            path: '/',
            isSecure: config.get('session.cookie.secure'),
            isHttpOnly: false,
            isSameSite: 'Lax'
          })
        }
      }
    }

    return response
  }
}
