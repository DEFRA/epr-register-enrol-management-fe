import { load } from 'cheerio'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { getCrumbToken } from '#/test-helpers/csrf.js'
import { consentCookie } from '#/test-helpers/analytics-consent.js'
import { buildConsentRecord } from '#/server/common/analytics/consent.js'

// Any page rendered from the shared layout carries the banner. The signed-out
// page is used because it needs no backend and proves the banner shows
// before sign-in.
const PAGE = '/auth/logged-out'

const original = {
  isEnabled: config.get('analytics.isEnabled'),
  measurementId: config.get('analytics.measurementId')
}

function cookieHeaderFrom(res) {
  return []
    .concat(res.headers['set-cookie'] ?? [])
    .map((header) => header.split(';')[0])
    .join('; ')
}

describe('cookie banner', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  afterEach(() => {
    config.set('analytics.isEnabled', original.isEnabled)
    config.set('analytics.measurementId', original.measurementId)
  })

  async function render({ cookie, url = PAGE } = {}) {
    const res = await server.inject({
      method: 'GET',
      url,
      headers: cookie ? { cookie } : {}
    })
    return { res, $: load(res.result) }
  }

  test('links to the cookies page from the footer, whether or not analytics is on', async () => {
    const { $ } = await render()

    expect($('[data-testid="footer-cookies"]').attr('href')).toBe('/cookies')
  })

  test.each([
    { isEnabled: false, measurementId: '' },
    { isEnabled: false, measurementId: 'G-TEST' },
    { isEnabled: true, measurementId: '' }
  ])(
    'is not shown when analytics is off (isEnabled=$isEnabled, measurementId="$measurementId")',
    async ({ isEnabled, measurementId }) => {
      config.set('analytics.isEnabled', isEnabled)
      config.set('analytics.measurementId', measurementId)

      const { $ } = await render()

      expect($('[data-testid="cookie-banner"]')).toHaveLength(0)
    }
  )

  describe('with analytics on', () => {
    beforeEach(() => {
      config.set('analytics.isEnabled', true)
      config.set('analytics.measurementId', 'G-TEST')
    })

    test('asks a visitor who has not answered', async () => {
      const { $ } = await render({ url: `${PAGE}?from=test` })

      const form = $('[data-testid="cookie-banner-form"]')
      expect(form.attr('method')).toBe('post')
      expect(form.attr('action')).toBe('/cookies/consent')
      expect(form.find('input[name="crumb"]').val()).toBeTruthy()
      expect(form.find('input[name="returnUrl"]').val()).toBe(
        `${PAGE}?from=test`
      )
      expect(
        form.find('[data-testid="cookie-banner-accept"]').attr('value')
      ).toBe('accepted')
      expect(
        form.find('[data-testid="cookie-banner-reject"]').attr('value')
      ).toBe('rejected')
      expect(form.find('a[href="/cookies"]')).toHaveLength(1)
    })

    test('is shown on the not-found page too', async () => {
      const { res, $ } = await render({ url: '/no-such-page' })

      expect(res.statusCode).toBe(404)
      expect($('[data-testid="cookie-banner"]')).toHaveLength(1)
    })

    test('comes before the skip link, as GOV.UK requires', async () => {
      const { res } = await render()
      const html = res.result

      expect(html.indexOf('data-testid="cookie-banner"')).toBeGreaterThan(-1)
      expect(html.indexOf('data-testid="cookie-banner"')).toBeLessThan(
        html.indexOf('govuk-skip-link')
      )
    })

    test.each(['accepted', 'rejected'])(
      'is not shown once the visitor has answered (%s)',
      async (choice) => {
        const { $ } = await render({ cookie: consentCookie(choice) })

        expect($('[data-testid="cookie-banner"]')).toHaveLength(0)
        expect($('[data-testid="cookie-banner-confirmation"]')).toHaveLength(0)
      }
    )

    test.each([
      ['an earlier policy version', consentCookie('accepted', { version: 0 })],
      ['a bare string', 'analyticsConsent=accepted'],
      [
        'raw JSON',
        `analyticsConsent=${JSON.stringify(buildConsentRecord('accepted'))}`
      ],
      ['malformed base64', 'analyticsConsent=e30$$$']
    ])('asks again for an answer to %s', async (_label, cookie) => {
      const { $ } = await render({ cookie })

      expect($('[data-testid="cookie-banner"]')).toHaveLength(1)
    })

    test.each(['accepted', 'rejected'])(
      'confirms the answer (%s) once on the page the visitor returns to',
      async (choice) => {
        const crumb = await getCrumbToken(server)
        const saved = await server.inject({
          method: 'POST',
          url: '/cookies/consent',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            cookie: `crumb=${crumb}`
          },
          payload: `analytics=${choice}&returnUrl=${encodeURIComponent(PAGE)}&crumb=${encodeURIComponent(crumb)}`
        })
        const cookie = `crumb=${crumb}; ${cookieHeaderFrom(saved)}`

        const first = await render({ cookie })
        const confirmation = first.$(
          '[data-testid="cookie-banner-confirmation"]'
        )
        expect(confirmation.text()).toContain(
          `You've ${choice} analytics cookies.`
        )
        expect(
          confirmation.find('[data-testid="cookie-banner-hide"]').attr('href')
        ).toBe(PAGE)

        const second = await render({
          cookie: `${cookie}; ${cookieHeaderFrom(first.res)}`
        })
        expect(
          second.$('[data-testid="cookie-banner-confirmation"]')
        ).toHaveLength(0)
      }
    )
  })
})
