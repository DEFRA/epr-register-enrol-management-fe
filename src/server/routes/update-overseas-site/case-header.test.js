import { describe, expect, test } from 'vitest'

import { buildUpdateOverseasSiteHeader } from './case-header.js'

const EM_DASH = '—'

const SHARED_HEADER = {
  backHref: '/work-items',
  backText: 'Applications',
  applicationRef: 'IYC-ORS-2026-00004'
}

function headerFor(payload) {
  return buildUpdateOverseasSiteHeader({
    header: SHARED_HEADER,
    workItem: {
      id: 'w-1',
      typeId: 'update-overseas-site',
      stateId: 'submitted',
      payload
    },
    assignment: null
  })
}

function metaKeys(header) {
  return header.meta.map((entry) => entry.key)
}

function metaValue(header, key) {
  return header.meta.find((entry) => entry.key === key)?.value
}

describe('RA-782: ORS update case header', () => {
  test('AC1: shows the application reference above the title', () => {
    const header = headerFor({ site: { siteName: 'Denmark PR', orsId: '7' } })

    expect(header.caption).toBe('IYC-ORS-2026-00004')
    expect(header.title).toBe('Denmark PR (7)')
  })

  test("AC1: shows the site's location, address parts and country, after the accreditation number", () => {
    const header = headerFor({
      accreditationReference: 'ACC-1',
      site: {
        addressLine1: 'Ejbyvvej 12',
        addressLine2: 'Industrial Park',
        townOrCity: 'Copenhagen',
        country: 'Denmark'
      }
    })

    expect(metaValue(header, 'location')).toBe(
      'Ejbyvvej 12, Industrial Park, Copenhagen, Denmark'
    )
    const keys = metaKeys(header)
    expect(keys.indexOf('location')).toBe(
      keys.indexOf('accreditation-number') + 1
    )
  })

  test('a site with no address has the dash for its location', () => {
    expect(metaValue(headerFor({}), 'location')).toBe(EM_DASH)
  })

  test('AC4: the charge and payment date read "-", whatever the payload says', () => {
    const header = headerFor({
      paymentDate: '2027-02-12',
      site: { chargePence: 0 }
    })

    expect(metaValue(header, 'charge')).toBe('-')
    expect(metaValue(header, 'payment-date')).toBe('-')
  })
})
