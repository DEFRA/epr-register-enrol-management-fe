import { config } from '#/config/config.js'
import {
  ANALYTICS_CONSENT_COOKIE,
  ANALYTICS_CONSENT,
  ANALYTICS_CONSENT_VERSION,
  analyticsConsent,
  buildConsentRecord
} from './consent.js'

// `cookie` is the value as hapi hands it over, already decoded.
function requestWith({ cookie, pathname = '/work-items', search = '' } = {}) {
  return {
    state: cookie === undefined ? {} : { [ANALYTICS_CONSENT_COOKIE]: cookie },
    url: { pathname, search }
  }
}

describe('analyticsConsent', () => {
  const original = {
    isEnabled: config.get('analytics.isEnabled'),
    measurementId: config.get('analytics.measurementId')
  }

  afterEach(() => {
    config.set('analytics.isEnabled', original.isEnabled)
    config.set('analytics.measurementId', original.measurementId)
  })

  test('uses the same cookie name and answer values as ReEx', () => {
    expect(ANALYTICS_CONSENT_COOKIE).toBe('analyticsConsent')
    expect(ANALYTICS_CONSENT).toEqual({
      accepted: 'accepted',
      rejected: 'rejected'
    })
  })

  describe('buildConsentRecord', () => {
    test('records the answer, the policy version and when it was given', () => {
      expect(
        buildConsentRecord('accepted', new Date('2026-10-02T12:00:00.000Z'))
      ).toEqual({
        analytics: 'accepted',
        version: ANALYTICS_CONSENT_VERSION,
        decidedAt: '2026-10-02T12:00:00.000Z'
      })
    })

    test('defaults to the current time', () => {
      const before = Date.now()
      const { decidedAt } = buildConsentRecord('rejected')

      expect(Date.parse(decidedAt)).toBeGreaterThanOrEqual(before)
      expect(Date.parse(decidedAt)).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('when analytics is off', () => {
    test('never asks and never consents, whatever the cookie says', () => {
      expect(
        analyticsConsent(
          requestWith({ cookie: buildConsentRecord('accepted') })
        )
      ).toEqual({
        hasConsented: false,
        hasRejected: false,
        isEnabled: false,
        returnUrl: '/work-items',
        shouldAskConsent: false
      })
    })
  })

  describe('when analytics is on', () => {
    beforeEach(() => {
      config.set('analytics.isEnabled', true)
      config.set('analytics.measurementId', 'G-TEST')
    })

    test('asks a visitor who has not answered', () => {
      expect(analyticsConsent(requestWith())).toEqual({
        hasConsented: false,
        hasRejected: false,
        isEnabled: true,
        returnUrl: '/work-items',
        shouldAskConsent: true
      })
    })

    test('records an accepted answer', () => {
      expect(
        analyticsConsent(
          requestWith({ cookie: buildConsentRecord('accepted') })
        )
      ).toEqual(
        expect.objectContaining({
          hasConsented: true,
          hasRejected: false,
          shouldAskConsent: false
        })
      )
    })

    test('records a rejected answer', () => {
      expect(
        analyticsConsent(
          requestWith({ cookie: buildConsentRecord('rejected') })
        )
      ).toEqual(
        expect.objectContaining({
          hasConsented: false,
          hasRejected: true,
          shouldAskConsent: false
        })
      )
    })

    test.each([
      [
        'an answer to an earlier policy version',
        { analytics: 'accepted', version: ANALYTICS_CONSENT_VERSION - 1 }
      ],
      [
        'an answer to a later policy version',
        { analytics: 'accepted', version: ANALYTICS_CONSENT_VERSION + 1 }
      ],
      ['a record with no version', { analytics: 'accepted' }],
      [
        'an unrecognised answer',
        { analytics: 'yes', version: ANALYTICS_CONSENT_VERSION }
      ],
      ['a string', 'accepted'],
      ['null', null]
    ])('treats %s as no answer', (_label, cookie) => {
      expect(analyticsConsent(requestWith({ cookie }))).toEqual(
        expect.objectContaining({
          hasConsented: false,
          hasRejected: false,
          shouldAskConsent: true
        })
      )
    })

    test('returnUrl keeps the query string', () => {
      expect(
        analyticsConsent(
          requestWith({ pathname: '/work-items', search: '?status=open' })
        ).returnUrl
      ).toBe('/work-items?status=open')
    })

    test('copes with no request at all', () => {
      expect(analyticsConsent(null)).toEqual({
        hasConsented: false,
        hasRejected: false,
        isEnabled: true,
        returnUrl: '/',
        shouldAskConsent: true
      })
    })
  })
})
