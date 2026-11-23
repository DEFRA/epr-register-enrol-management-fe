import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'vitest'
import nunjucks from 'nunjucks'
import { load } from 'cheerio'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const env = nunjucks.configure(
  [
    path.resolve(dirname, '../../../../node_modules/govuk-frontend/dist/'),
    path.resolve(dirname, '..')
  ],
  { autoescape: true, trimBlocks: true, lstripBlocks: true }
)

function render(sites, { multiple = false, options = {} } = {}) {
  const out = env.renderString(
    `{%- from "work-items/summary-macros.njk" import overseasSiteList -%}` +
      `{{- overseasSiteList(sites, multiple, options) -}}`,
    { sites, multiple, options }
  )
  return load(out)
}

const interimSite = (siteName, isNew = false) => ({
  siteName,
  isNew,
  addressLines: ['1 Interim Road', 'Rotterdam'],
  details: [{ key: 'contact', label: 'Contact', values: ['Ana'] }]
})

const site = (siteName, interimSites = [], isNew = false) => ({
  siteName,
  isNew,
  summaryAddress: 'Havenstraat, Netherlands',
  addressLines: ['1 Havenstraat', 'Netherlands'],
  details: [{ key: 'ors-id', label: 'ORS ID', values: ['7'] }],
  interimSites,
  interimSite: interimSites[0] ?? null
})

const byTestId = ($, testId) => $(`[data-testid="${testId}"]`)

describe('overseasSiteList', () => {
  describe('by default (re-accreditation)', () => {
    test('renders each site collapsed with its name and summary address', () => {
      const $ = render([site('Alpha'), site('Beta')])

      const blocks = byTestId($, 'overseas-site')
      expect(blocks).toHaveLength(2)
      expect(blocks.first().is('details')).toBe(true)
      expect(blocks.first().attr('open')).toBeUndefined()
      expect(byTestId($, 'overseas-site-name').first().text().trim()).toBe(
        'Alpha'
      )
      expect(byTestId($, 'overseas-site-summary-address').first().text()).toBe(
        'Havenstraat, Netherlands'
      )
    })

    test('renders no site number unless the site has one', () => {
      const $ = render([site('Alpha')])

      expect(byTestId($, 'overseas-site-number')).toHaveLength(0)
    })

    test('renders an em dash when there are no sites', () => {
      const $ = render([])

      expect(byTestId($, 'overseas-site')).toHaveLength(0)
      expect($.root().text().trim()).toBe('—')
    })

    test('with the flag off, shows the single interim site already open', () => {
      const $ = render([site('Alpha', [interimSite('Depot')])])

      const interim = byTestId($, 'interim-site')
      expect(interim).toHaveLength(1)
      expect(interim.is('div')).toBe(true)
      expect(byTestId($, 'interim-sites')).toHaveLength(0)
      expect(byTestId($, 'interim-site-name').text().trim()).toBe('Depot')
    })

    test('with the flag on, lists every interim site with a count, collapsed', () => {
      const $ = render(
        [site('Alpha', [interimSite('Depot'), interimSite('Yard')])],
        { multiple: true }
      )

      expect(byTestId($, 'interim-sites-label').text()).toBe(
        'Interim sites (2)'
      )
      const interims = byTestId($, 'interim-site')
      expect(interims).toHaveLength(2)
      expect(interims.first().is('details')).toBe(true)
      expect(interims.first().attr('open')).toBeUndefined()
    })

    test.each([false, true])(
      'marks new sites and renders nothing for no interim sites (flag %s)',
      (multiple) => {
        const $ = render(
          [site('Alpha', [interimSite('Depot', true)], true), site('Beta')],
          { multiple }
        )

        expect(byTestId($, 'overseas-site-new-tag')).toHaveLength(1)
        expect(byTestId($, 'interim-site-new-tag')).toHaveLength(1)
        expect(byTestId($, 'interim-sites-none')).toHaveLength(0)
      }
    )
  })

  describe.each([false, true])('with the interim flag %s', (multiple) => {
    test('hideNewMarkers leaves out every NEW: marker', () => {
      const $ = render([site('Alpha', [interimSite('Depot', true)], true)], {
        multiple,
        options: { hideNewMarkers: true }
      })

      expect($.root().text()).not.toContain('NEW:')
      expect(byTestId($, 'overseas-site-name').text().trim()).toBe('Alpha')
      expect(byTestId($, 'interim-site-name').text().trim()).toBe('Depot')
    })

    test('showNoInterimSites says so for a site with none', () => {
      const $ = render([site('Alpha'), site('Beta', [interimSite('Depot')])], {
        multiple,
        options: { showNoInterimSites: true }
      })

      const none = byTestId($, 'interim-sites-none')
      expect(none).toHaveLength(1)
      expect(none.text()).toBe('No interim sites')
      expect(byTestId($, 'overseas-site').first().find(none).length).toBe(1)
    })
  })
})

describe('overseasSiteList site number (RA-769)', () => {
  test('shows the number before the name in the summary, outside the name element', () => {
    const $ = render([{ ...site('Alpha'), siteNumber: '001' }])

    expect(byTestId($, 'overseas-site-number').first().text().trim()).toBe(
      '001'
    )
    expect($('summary').text().replace(/\s+/g, ' ').trim()).toMatch(
      /^001 Alpha/
    )
    expect(byTestId($, 'overseas-site-name').first().text().trim()).toBe(
      'Alpha'
    )
  })
})
