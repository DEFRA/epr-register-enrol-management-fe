import { describe, expect, test } from 'vitest'

import { buildUpdateOverseasSiteSummary } from './application-summary.js'

const EM_DASH = '—'

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
    contactPhone: '+45 1234 5678',
    operationCodes: ['R13'],
    ...overrides
  }
}

function interimDetails(site) {
  const { siteId, siteNumber, removedAt, ...details } = site
  return details
}

function aSite(overrides = {}) {
  return {
    siteId: 902501,
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
    chargePence: 0,
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
    previous: {
      siteName: 'Denmark PR',
      addressLine1: 'Ejbyvvej 12',
      addressLine2: 'Industrial Park',
      townOrCity: 'Copenhagen',
      contactName: 'John Smith',
      contactEmail: 'john.smith@denmarkpr.com',
      contactPhone: '+23 2489 2862',
      repatriatedLoads: 'Returned to the UK exporter.'
    },
    proposed: {
      siteName: 'Denmark PR North',
      addressLine1: 'Ejbyvvej 12',
      addressLine2: null,
      townOrCity: 'Copenhagen',
      contactName: 'Jane Doe',
      contactEmail: 'john.smith@denmarkpr.com',
      contactPhone: '+23 2489 2862',
      repatriatedLoads: 'Returned to the UK exporter.'
    },
    interimSiteChanges: [],
    ...overrides
  }
}

function summaryFor(site, extra = {}) {
  return buildUpdateOverseasSiteSummary({
    workItem: {
      id: 'w-1',
      payload: { accreditationYear: 2026, ...extra, site }
    }
  })
}

function rowsByKey(summary) {
  return Object.fromEntries(
    summary.groups.flatMap((group) => group.rows).map((row) => [row.key, row])
  )
}

describe('buildUpdateOverseasSiteSummary (RA-782)', () => {
  test('introduces the change with the ORS id and accreditation year', () => {
    expect(summaryFor(aSite()).intro).toBe(
      'The operator wants to change the details of ORS 007, which is on their 2026 accreditation. Each changed detail is marked.'
    )
  })

  test('introduces the change with a dash and no year when they are missing', () => {
    const summary = buildUpdateOverseasSiteSummary({
      workItem: { payload: { site: { orsId: ' ' } } }
    })
    expect(summary.intro).toBe(
      `The operator wants to change the details of ORS ${EM_DASH}, which is on their accreditation. Each changed detail is marked.`
    )
  })

  test('groups the rows as the design does, with add-ORS labels', () => {
    const summary = summaryFor(aSite())
    expect(
      summary.groups.map((group) => [
        group.key,
        group.title,
        group.rows.map((row) => row.label)
      ])
    ).toEqual([
      [
        'site-details',
        'Site details',
        ['ORS ID', 'Site name', 'Location', 'Coordinates']
      ],
      [
        'contact-details',
        'Contact details',
        ['Contact name', 'Contact email', 'Contact phone number']
      ],
      [
        'operations',
        'Operations',
        [
          'Operation code',
          'Basel/OECD codes',
          'Arrangements for rejected or returned loads',
          'Conditions of export'
        ]
      ]
    ])
  })

  test('compares the editable details, previous against proposed, and marks each change', () => {
    const rows = rowsByKey(summaryFor(aSite()))

    expect(rows['site-name']).toEqual({
      key: 'site-name',
      label: 'Site name',
      current: ['Denmark PR'],
      requested: ['Denmark PR North'],
      changed: true
    })
    // A cleared address line 2 stays cleared; the country is the site's.
    expect(rows.location.current).toEqual([
      'Ejbyvvej 12, Industrial Park, Copenhagen, Denmark'
    ])
    expect(rows.location.requested).toEqual([
      'Ejbyvvej 12, Copenhagen, Denmark'
    ])
    expect(rows.location.changed).toBe(true)
    expect(rows['contact-name'].changed).toBe(true)
    expect(rows['contact-email'].changed).toBe(false)
    expect(rows['repatriated-loads'].changed).toBe(false)
  })

  test('shows the locked details unchanged from the site', () => {
    const rows = rowsByKey(summaryFor(aSite()))

    expect(rows['ors-id']).toMatchObject({
      current: ['007'],
      requested: ['007'],
      changed: false
    })
    expect(rows.coordinates.requested).toEqual(['55.6761, 12.5683'])
    expect(rows['recycling-operation'].requested).toEqual(['R5, R13'])
    expect(rows['basel-codes'].requested).toEqual(['B1030, B3011'])
    expect(rows['conditions-of-export']).toMatchObject({
      current: ['Yes'],
      requested: ['Yes'],
      changed: false
    })
  })

  test('falls back to the site when there is no previous or proposed, and shows the dash for a gap', () => {
    const rows = rowsByKey(
      summaryFor(
        aSite({ previous: null, proposed: undefined, contactPhone: null })
      )
    )
    expect(rows['site-name']).toMatchObject({
      current: ['Denmark PR'],
      requested: ['Denmark PR'],
      changed: false
    })
    expect(rows['contact-phone']).toMatchObject({
      current: [EM_DASH],
      requested: [EM_DASH],
      changed: false
    })
  })

  test("lists the ORS's BES files then the added ones, marked new and downloadable when clean", () => {
    const summary = summaryFor(
      aSite({
        addedBesEvidence: {
          files: [
            { fileId: 'bes-new', filename: 'new.pdf', scanStatus: 'Clean' },
            { fileId: 'bes-new-2', filename: 'pending.pdf' }
          ]
        }
      })
    )
    expect(
      summary.besEvidence.files.map(({ filename, href, isNew }) => ({
        filename,
        href,
        isNew
      }))
    ).toEqual([
      {
        filename: 'bes-evidence.pdf',
        href: '/work-items/w-1/files/bes-clean/download',
        isNew: false
      },
      {
        filename: 'new.pdf',
        href: '/work-items/w-1/files/bes-new/download',
        isNew: true
      },
      { filename: 'pending.pdf', href: null, isNew: true }
    ])
    expect(summary.besEvidence.files[0].validFrom).toBe('01 Jan 2027')
  })

  test('has no BES files when neither list has any', () => {
    const summary = summaryFor(
      aSite({ besEvidence: null, addedBesEvidence: { files: 'none' } })
    )
    expect(summary.besEvidence.files).toEqual([])
  })

  describe('interim sites', () => {
    test('shows an unchanged active interim site as No changes, closed, with a compare table', () => {
      const [interim] = summaryFor(aSite()).interimSites
      expect(interim).toMatchObject({
        number: 1,
        siteName: 'Bharat Recycling',
        kind: 'unchanged',
        tag: 'No changes',
        tagClass: 'govuk-tag--grey',
        open: false,
        note: null,
        details: null
      })
      expect(interim.rows.every((row) => !row.changed)).toBe(true)
      expect(interim.rows.map((row) => row.key)).toEqual([
        'site-number',
        'location',
        'contact-name',
        'contact-email',
        'contact-phone',
        'operation-code'
      ])
    })

    test('compares a changed interim site, open, with each change marked', () => {
      const existing = anInterimSite()
      const [interim] = summaryFor(
        aSite({
          interimSiteChanges: [
            {
              changeId: 'c-1',
              action: 'change',
              interimSiteId: 101,
              previous: interimDetails(existing),
              proposed: {
                ...interimDetails(existing),
                contactName: 'Lucía Martín'
              }
            }
          ]
        })
      ).interimSites
      expect(interim).toMatchObject({
        kind: 'changed',
        tag: 'Changed',
        tagClass: 'govuk-tag--blue',
        open: true
      })
      const contact = interim.rows.find((row) => row.key === 'contact-name')
      expect(contact).toMatchObject({
        current: ['Asha Patel'],
        requested: ['Lucía Martín'],
        changed: true
      })
      // The site number is the interim site's own, on both sides.
      expect(interim.rows[0]).toMatchObject({
        current: ['SN-0101'],
        changed: false
      })
    })

    test('shows a change that changes nothing as No changes', () => {
      const existing = anInterimSite()
      const [interim] = summaryFor(
        aSite({
          interimSiteChanges: [
            {
              action: 'change',
              interimSiteId: '101',
              previous: interimDetails(existing),
              proposed: interimDetails(existing)
            }
          ]
        })
      ).interimSites
      expect(interim.kind).toBe('unchanged')
    })

    test('lists a removed interim site, open, with a note and its details', () => {
      const [interim] = summaryFor(
        aSite({
          interimSiteChanges: [
            {
              action: 'remove',
              interimSiteId: 101,
              previous: interimDetails(anInterimSite())
            }
          ]
        })
      ).interimSites
      expect(interim).toMatchObject({
        number: 1,
        siteName: 'Bharat Recycling',
        kind: 'removed',
        tag: 'Removed',
        tagClass: 'govuk-tag--red',
        note: 'The operator wants to remove this interim site.',
        open: true,
        rows: null
      })
      expect(interim.details.find((d) => d.key === 'location').values).toEqual([
        'Havnegade 1, Aarhus, Denmark'
      ])
    })

    test('lists an added interim site after the existing ones, open, with no site number', () => {
      const summary = summaryFor(
        aSite({
          interimSiteChanges: [
            {
              action: 'add',
              proposed: {
                siteName: 'Sagunto transfer station',
                country: 'Spain',
                addressLine1: 'Polígono Ingruinsa',
                townOrCity: 'Sagunto',
                contactName: 'Pablo Gil',
                contactEmail: 'p.gil@example.com',
                contactPhone: '+34 962 690 100',
                operationCodes: ['R13']
              }
            }
          ]
        })
      )
      expect(summary.interimSites.map((site) => site.kind)).toEqual([
        'unchanged',
        'added'
      ])
      const added = summary.interimSites[1]
      expect(added).toMatchObject({
        number: 2,
        siteName: 'Sagunto transfer station',
        tag: 'New interim site',
        tagClass: 'govuk-tag--purple',
        note: 'This interim site is new. There is no previous version to compare it with.',
        open: true
      })
      expect(added.details[0]).toEqual({
        key: 'site-number',
        label: 'Site number',
        values: [EM_DASH]
      })
    })

    test('leaves out a withdrawn interim site but still shows a change to one no longer listed', () => {
      const summary = summaryFor(
        aSite({
          interimSites: [
            anInterimSite({ siteId: 102, removedAt: '2027-01-05T10:00:00Z' }),
            null
          ],
          interimSiteChanges: [
            null,
            {
              action: 'remove',
              interimSiteId: 555,
              previous: { siteName: 'Gone Yard' }
            },
            { action: 'add', proposed: null }
          ]
        })
      )
      expect(
        summary.interimSites.map(({ siteName, kind }) => [siteName, kind])
      ).toEqual([
        ['Gone Yard', 'removed'],
        [EM_DASH, 'added']
      ])
    })

    test('shows no interim sites when there are none', () => {
      expect(
        summaryFor(aSite({ interimSites: undefined, interimSiteChanges: null }))
          .interimSites
      ).toEqual([])
    })

    test('reads an interim site with no id as unchanged', () => {
      const [interim] = summaryFor(
        aSite({
          interimSites: [anInterimSite({ siteId: null })],
          interimSiteChanges: [{ action: 'change', interimSiteId: null }]
        })
      ).interimSites
      expect(interim.kind).toBe('unchanged')
    })
  })

  test('copes with a work item without a payload', () => {
    const summary = buildUpdateOverseasSiteSummary({ workItem: undefined })
    expect(summary.besEvidence.files).toEqual([])
    expect(summary.interimSites).toEqual([])
  })
})
