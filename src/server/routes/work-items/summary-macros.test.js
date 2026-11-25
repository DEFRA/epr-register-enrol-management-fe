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

function render(sites) {
  const out = env.renderString(
    `{%- from "work-items/summary-macros.njk" import overseasSiteList -%}` +
      `{{- overseasSiteList(sites) -}}`,
    { sites }
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
  interimSites
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

    test('lists every interim site with a count, each collapsed', () => {
      const $ = render([
        site('Alpha', [interimSite('Depot'), interimSite('Yard')])
      ])

      expect(byTestId($, 'interim-sites-label').text()).toBe(
        'Interim sites (2)'
      )
      const interims = byTestId($, 'interim-site')
      expect(interims).toHaveLength(2)
      expect(interims.first().is('details')).toBe(true)
      expect(interims.first().attr('open')).toBeUndefined()
    })

    test('marks new sites and renders nothing for no interim sites', () => {
      const $ = render([
        site('Alpha', [interimSite('Depot', true)], true),
        site('Beta')
      ])

      expect(byTestId($, 'overseas-site-new-tag')).toHaveLength(1)
      expect(byTestId($, 'interim-site-new-tag')).toHaveLength(1)
      expect(byTestId($, 'interim-sites')).toHaveLength(1)
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
