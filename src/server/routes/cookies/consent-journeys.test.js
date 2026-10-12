import { vi } from 'vitest'
import { load } from 'cheerio'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  ANALYTICS_CONSENT_COOKIE,
  ANALYTICS_CONSENT_VERSION
} from '#/server/common/analytics/consent.js'
import { decodeConsentValue } from '#/test-helpers/analytics-consent.js'

// Drives the forms exactly as rendered, the way a browser without JavaScript
// would: read the form's action and hidden fields, add the chosen button or
// radio, post it, follow the redirect, and carry cookies between requests.

const PAGE = '/auth/logged-out'

function createBrowser(server) {
  const jar = new Map()

  function storeCookies(res) {
    for (const header of [].concat(res.headers['set-cookie'] ?? [])) {
      const [pair, ...attributes] = header.split(';')
      const name = pair.slice(0, pair.indexOf('='))
      const value = pair.slice(pair.indexOf('=') + 1)
      const expired = attributes.some((a) => a.trim() === 'Max-Age=0')
      if (expired) {
        jar.delete(name)
      } else {
        jar.set(name, value)
      }
    }
  }

  async function request(opts) {
    const cookie = [...jar]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
    const res = await server.inject({
      ...opts,
      headers: { ...opts.headers, ...(cookie ? { cookie } : {}) }
    })
    storeCookies(res)
    return res
  }

  let current

  async function visit(url) {
    const res = await request({ method: 'GET', url })
    expect(res.statusCode).toBe(statusCodes.ok)
    current = { url, $: load(res.result) }
    return current.$
  }

  async function submit(formSelector, field) {
    const form = current.$(formSelector)
    expect(form).toHaveLength(1)

    const fields = new URLSearchParams()
    form.find('input[type="hidden"]').each((_i, input) => {
      fields.append(current.$(input).attr('name'), current.$(input).val())
    })
    fields.append(field.name, field.value)

    const res = await request({
      method: (form.attr('method') ?? 'get').toUpperCase(),
      url: form.attr('action'),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: fields.toString()
    })
    expect(res.statusCode).toBe(statusCodes.redirect)

    return visit(res.headers.location)
  }

  // Clicks one of the banner's submit buttons, by its value.
  function clickBannerButton(value) {
    const button = current.$(
      `[data-testid="cookie-banner-form"] button[value="${value}"]`
    )
    expect(button).toHaveLength(1)
    return submit('[data-testid="cookie-banner-form"]', {
      name: button.attr('name'),
      value
    })
  }

  // Picks a radio on the cookies page and saves.
  function saveOnCookiesPage(value) {
    const radio = current.$(
      `[data-testid="cookies-form"] input[type="radio"][value="${value}"]`
    )
    expect(radio).toHaveLength(1)
    return submit('[data-testid="cookies-form"]', {
      name: radio.attr('name'),
      value
    })
  }

  return {
    visit,
    clickBannerButton,
    saveOnCookiesPage,
    get url() {
      return current.url
    },
    consentRecord() {
      const value = jar.get(ANALYTICS_CONSENT_COOKIE)
      return value === undefined ? null : decodeConsentValue(value)
    }
  }
}

const bannerShown = ($) => $('[data-testid="cookie-banner"]').length === 1
const bannerConfirmation = ($) =>
  $('[data-testid="cookie-banner-confirmation"]').text()
const tagContainerId = ($) =>
  $('meta[name="analytics-gtm-container-id"]').attr('content')
const tagScriptLoaded = ($) =>
  $('script[src$="src/client/javascripts/analytics.js"]').length === 1
const selectedChoice = ($) =>
  $('[data-testid="cookies-form"] input[name="analytics"]:checked').val()

describe('consent journeys', () => {
  let server
  const original = {
    isEnabled: config.get('analytics.isEnabled'),
    gtmContainerId: config.get('analytics.gtmContainerId')
  }

  beforeAll(async () => {
    config.set('analytics.isEnabled', true)
    config.set('analytics.gtmContainerId', 'GTM-TEST')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set('analytics.isEnabled', original.isEnabled)
    config.set('analytics.gtmContainerId', original.gtmContainerId)
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    // Only Date is faked, so decidedAt is predictable without stalling hapi.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T09:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('via the banner', () => {
    test.each([
      ['accepted', "You've accepted analytics cookies."],
      ['rejected', "You've rejected analytics cookies."]
    ])(
      'answering %s sets the cookie and returns the visitor to the page',
      async (choice, message) => {
        const browser = createBrowser(server)
        expect(bannerShown(await browser.visit(PAGE))).toBe(true)

        const $ = await browser.clickBannerButton(choice)

        expect(browser.url).toBe(PAGE)
        expect(browser.consentRecord()).toEqual({
          analytics: choice,
          version: ANALYTICS_CONSENT_VERSION,
          decidedAt: '2026-10-05T09:00:00.000Z'
        })
        expect(bannerShown($)).toBe(false)
        expect(bannerConfirmation($)).toContain(message)

        const next = await browser.visit(PAGE)
        expect(bannerShown(next)).toBe(false)
        expect(bannerConfirmation(next)).toBe('')
      }
    )
  })

  describe('via the cookies page', () => {
    test.each(['accepted', 'rejected'])(
      'saving %s from an unanswered start sets the cookie',
      async (choice) => {
        const browser = createBrowser(server)
        expect(selectedChoice(await browser.visit('/cookies'))).toBeUndefined()

        const $ = await browser.saveOnCookiesPage(choice)

        expect(browser.url).toBe('/cookies')
        expect(browser.consentRecord()).toEqual({
          analytics: choice,
          version: ANALYTICS_CONSENT_VERSION,
          decidedAt: '2026-10-05T09:00:00.000Z'
        })
        expect($('[data-testid="cookies-saved"]')).toHaveLength(1)
        expect(selectedChoice($)).toBe(choice)

        expect(bannerShown(await browser.visit(PAGE))).toBe(false)
      }
    )
  })

  describe('answered on the banner, then changed on the cookies page', () => {
    test.each([
      ['accepted', 'rejected'],
      ['rejected', 'accepted']
    ])('%s, then %s', async (first, second) => {
      const browser = createBrowser(server)
      await browser.visit(PAGE)
      await browser.clickBannerButton(first)
      expect(browser.consentRecord().analytics).toBe(first)

      vi.setSystemTime(new Date('2026-10-06T10:30:00.000Z'))
      expect(selectedChoice(await browser.visit('/cookies'))).toBe(first)
      const $ = await browser.saveOnCookiesPage(second)

      expect(browser.consentRecord()).toEqual({
        analytics: second,
        version: ANALYTICS_CONSENT_VERSION,
        decidedAt: '2026-10-06T10:30:00.000Z'
      })
      expect(selectedChoice($)).toBe(second)

      const elsewhere = await browser.visit(PAGE)
      expect(bannerShown(elsewhere)).toBe(false)
      expect(bannerConfirmation(elsewhere)).toBe('')
    })
  })

  describe('the Tag Manager container follows consent', () => {
    test('is not loaded before the visitor answers', async () => {
      const $ = await createBrowser(server).visit(PAGE)

      expect(tagContainerId($)).toBeUndefined()
      expect(tagScriptLoaded($)).toBe(false)
    })

    test('loads from the page that confirms acceptance onwards', async () => {
      const browser = createBrowser(server)
      await browser.visit(PAGE)

      const confirmed = await browser.clickBannerButton('accepted')
      expect(tagContainerId(confirmed)).toBe('GTM-TEST')
      expect(tagScriptLoaded(confirmed)).toBe(true)

      expect(tagContainerId(await browser.visit('/cookies'))).toBe('GTM-TEST')
    })

    test('is never loaded for a visitor who rejects', async () => {
      const browser = createBrowser(server)
      await browser.visit(PAGE)

      const confirmed = await browser.clickBannerButton('rejected')
      expect(tagScriptLoaded(confirmed)).toBe(false)
      expect(tagScriptLoaded(await browser.visit(PAGE))).toBe(false)
    })

    test('stops loading as soon as consent is withdrawn', async () => {
      const browser = createBrowser(server)
      await browser.visit(PAGE)
      await browser.clickBannerButton('accepted')

      await browser.visit('/cookies')
      const saved = await browser.saveOnCookiesPage('rejected')

      expect(tagContainerId(saved)).toBeUndefined()
      expect(tagScriptLoaded(saved)).toBe(false)
      expect(tagScriptLoaded(await browser.visit(PAGE))).toBe(false)
    })
  })
})
