import { describe, expect, test } from 'vitest'

import { buildAddOverseasSiteSummary } from './application-summary.js'

const EM_DASH = '—'

const ROW_LABELS = [
  ['site-name', 'Site name'],
  ['location', 'Location'],
  ['coordinates', 'Coordinates'],
  ['contact-name', 'Contact name'],
  ['contact-email', 'Contact email'],
  ['contact-phone', 'Contact phone number'],
  ['recycling-operation', 'Recycling operation'],
  ['basel-codes', 'Basel convention codes'],
  ['repatriated-loads', 'Arrangements for rejected or returned loads'],
  ['conditions-of-export', 'Conditions of export'],
  ['bes-evidence', 'Evidence of broadly equivalent standards']
]

function anInterimSite(overrides = {}) {
  return {
    siteId: 101,
    siteNumber: 'SN-0101',
    siteName: 'Bharat Recycling',
    addressLine1: 'Havnegade 1',
    townOrCity: 'Aarhus',
    country: 'Denmark',
    contactName: 'Asha Patel',
    contactEmail: 'asha@bharat.example',
    operationCodes: ['R13'],
    ...overrides
  }
}

function aSite(overrides = {}) {
  return {
    orsId: '007',
    siteName: 'Denmark PR',
    addressLine1: 'Ejbyvvej 12',
    addressLine2: 'Industrial Park',
    townOrCity: 'Copenhagen',
    country: 'Denmark',
    coordinates: '55.6761, 12.5683',
    contactName: 'John Smith',
    contactEmail: 'john.smith@denmarkpr.com',
    contactPhone: '+23 2489 2862',
    operationCodes: ['R5', 'R13'],
    code1: 'B1030',
    code2: '',
    code3: 'B3011',
    repatriatedLoads: 'Returned to the UK exporter.',
    conditionsOfExport: true,
    isEu: true,
    isOecd: true,
    besEvidence: {
      files: [
        {
          fileId: 'bes-clean',
          filename: 'bes-evidence.pdf',
          scanStatus: 'Clean',
          besEvidenceValidFromDate: '2027-01-01',
          besEvidenceExpiryDate: '2028-12-31'
        }
      ]
    },
    interimSites: [anInterimSite()],
    ...overrides
  }
}

function summaryFor(site) {
  return buildAddOverseasSiteSummary({
    workItem: { id: 'w-1', payload: site === undefined ? {} : { site } }
  })
}

function valuesByKey(rows) {
  return Object.fromEntries(
    rows
      .filter((row) => row.kind === 'lines')
      .map((row) => [row.key, row.values])
  )
}

describe('RA-739: #buildAddOverseasSiteSummary', () => {
  test('renders the site rows in Figma order', () => {
    const { rows } = summaryFor(aSite())

    expect(rows.map((row) => [row.key, row.label])).toEqual(ROW_LABELS)
    expect(valuesByKey(rows)).toEqual({
      'site-name': ['Denmark PR'],
      location: ['Ejbyvvej 12, Industrial Park, Copenhagen, Denmark'],
      coordinates: ['55.6761, 12.5683'],
      'contact-name': ['John Smith'],
      'contact-email': ['john.smith@denmarkpr.com'],
      'contact-phone': ['+23 2489 2862'],
      'recycling-operation': ['R5, R13'],
      'basel-codes': ['B1030, B3011'],
      'repatriated-loads': ['Returned to the UK exporter.'],
      'conditions-of-export': ['Yes']
    })
  })

  test('does not show ORS ID, EU or OECD', () => {
    const labels = summaryFor(aSite()).rows.map((row) => row.label)
    expect(labels).not.toContain('ORS ID')
    expect(labels.join(' ')).not.toMatch(/EU|OECD/)
  })

  test.each([
    ['an empty site', {}],
    ['no site', undefined]
  ])('renders every row with the dash for %s', (_, site) => {
    const { rows } = summaryFor(site)

    expect(rows.map((row) => [row.key, row.label])).toEqual(ROW_LABELS)
    for (const values of Object.values(valuesByKey(rows))) {
      expect(values).toEqual([EM_DASH])
    }
    expect(rows.find((row) => row.key === 'bes-evidence').files).toEqual([])
  })

  test('shows the BES evidence files with their dates and a Clean-only link', () => {
    const site = aSite()
    site.besEvidence.files.push({
      fileId: 'bes-pending',
      filename: 'bes-pending.pdf',
      scanStatus: 'Pending'
    })

    const besRow = summaryFor(site).rows.find(
      (row) => row.key === 'bes-evidence'
    )

    expect(besRow.kind).toBe('files')
    expect(besRow.files).toEqual([
      expect.objectContaining({
        filename: 'bes-evidence.pdf',
        href: '/work-items/w-1/files/bes-clean/download',
        scanStatus: 'Clean',
        validFrom: '01 Jan 2027',
        expiryDate: '31 Dec 2028'
      }),
      expect.objectContaining({
        filename: 'bes-pending.pdf',
        href: null,
        scanStatus: 'Pending',
        validFrom: EM_DASH,
        expiryDate: EM_DASH
      })
    ])
  })

  describe('interim sites', () => {
    test('lists each interim site with a heading and its fields', () => {
      expect(summaryFor(aSite()).interimSites).toEqual([
        {
          siteName: 'Bharat Recycling',
          shortAddress: 'Havnegade 1, Denmark',
          details: [
            {
              key: 'site-number',
              label: 'Site number',
              values: ['SN-0101']
            },
            {
              key: 'location',
              label: 'Location',
              values: ['Havnegade 1, Aarhus, Denmark']
            },
            {
              key: 'contact-name',
              label: 'Contact name',
              values: ['Asha Patel']
            },
            {
              key: 'contact-email',
              label: 'Contact email',
              values: ['asha@bharat.example']
            },
            {
              key: 'operation-code',
              label: 'Operation code',
              values: ['R13']
            }
          ]
        }
      ])
    })

    test('shows the dash for an interim site with no details', () => {
      const [interim] = summaryFor(
        aSite({ interimSites: [{ siteId: 1 }] })
      ).interimSites

      expect(interim.siteName).toBe(EM_DASH)
      expect(interim.shortAddress).toBe('')
      for (const detail of interim.details) {
        expect(detail.values).toEqual([EM_DASH])
      }
    })

    test('leaves out withdrawn interim sites', () => {
      const site = aSite({
        interimSites: [
          anInterimSite(),
          anInterimSite({
            siteName: 'Withdrawn Hub',
            removedAt: '2027-01-05T10:00:00Z'
          })
        ]
      })

      expect(
        summaryFor(site).interimSites.map((interim) => interim.siteName)
      ).toEqual(['Bharat Recycling'])
    })

    test.each([
      ['interimSites is absent', { interimSites: undefined }],
      ['interimSites is empty', { interimSites: [] }],
      [
        'every interim site is withdrawn',
        {
          interimSites: [anInterimSite({ removedAt: '2027-01-05T10:00:00Z' })]
        }
      ]
    ])('has no interim sites when %s', (_, overrides) => {
      expect(summaryFor(aSite(overrides)).interimSites).toEqual([])
    })

    test('has no interim sites when there is no site', () => {
      expect(summaryFor(undefined).interimSites).toEqual([])
    })
  })
})
