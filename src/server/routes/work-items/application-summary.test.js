import { describe, expect, test } from 'vitest'

import {
  buildApplicationSummary,
  buildBusinessPlanPairs,
  buildCaseFooterRows,
  buildSiteAddressLines,
  isExporterApplication,
  tonnageBandLabel
} from './application-summary.js'

const EM_DASH = '—'

function row(rows, key) {
  return rows.find((r) => r.key === key)
}

const REPROCESSOR = {
  id: 'w-1',
  typeId: 're-accreditation',
  typeDisplayName: 'Re-accreditation',
  payload: {
    applicationReference: 'RA-2026-00001',
    organisationName: 'GreenLoop Recovery',
    material: 'plastic',
    siteAddress: {
      line1: '2 Wyld Court',
      town: 'Addingrove',
      postcode: 'AA3 1AA'
    },
    prns: {
      plannedTonnageBand: 'UpTo1000',
      authorisers: [
        { fullName: 'Harry Edge', email: 'harry@example.com' },
        { fullName: 'Rosina Campbell', email: 'rosina@example.com' }
      ]
    },
    samplingPlan: {
      files: [
        {
          fileId: 'f-1',
          filename: 'sampling-plan.pdf',
          scanStatus: 'Clean',
          uploadedAt: '2026-06-01T10:00:00Z'
        },
        {
          fileId: 'f-2',
          filename: 'inspection-notes.pdf',
          scanStatus: 'Pending',
          uploadedAt: '2026-06-02T10:00:00Z',
          uploadedBy: 'Priya Sharma'
        }
      ]
    },
    businessPlan: {
      newInfrastructurePercent: 80,
      newInfrastructureDetail: "I'll spend the income to…"
    }
  }
}

const EXPORTER = {
  ...REPROCESSOR,
  payload: {
    ...REPROCESSOR.payload,
    overseasSites: {
      sites: [
        {
          siteName: 'Rotterdam Reprocessing',
          country: 'Netherlands',
          siteAddress: '1 Overseas Lane, Rotterdam',
          besEvidence: {
            files: [
              {
                fileId: 'b-1',
                filename: 'bes-evidence.pdf',
                scanStatus: 'Clean'
              }
            ]
          }
        }
      ]
    }
  }
}

describe('#tonnageBandLabel', () => {
  test('maps every known band to its human label', () => {
    expect(tonnageBandLabel('UpTo500')).toBe('Up to 500 tonnes')
    expect(tonnageBandLabel('UpTo1000')).toBe('Up to 1,000 tonnes')
    expect(tonnageBandLabel('UpTo10000')).toBe('Up to 10,000 tonnes')
    expect(tonnageBandLabel('Over10000')).toBe('Over 10,000 tonnes')
  })

  test('passes an unknown band through rather than hiding it', () => {
    expect(tonnageBandLabel('some_future_band')).toBe('some_future_band')
  })

  test('renders an em dash when absent', () => {
    expect(tonnageBandLabel(null)).toBe(EM_DASH)
    expect(tonnageBandLabel(undefined)).toBe(EM_DASH)
  })
})

describe('#buildSiteAddressLines (RA-245)', () => {
  test('adds the nested postcode as a second line', () => {
    expect(
      buildSiteAddressLines({
        siteAddress: {
          line1: '1 Details Lane',
          town: 'Leeds',
          postcode: 'LS1 1AB'
        }
      })
    ).toEqual(['1 Details Lane, Leeds', 'LS1 1AB'])
  })

  test('does not repeat a postcode already inside a legacy flat string', () => {
    expect(
      buildSiteAddressLines({
        siteAddress: '1 Main St, Leeds, LS1 1AB',
        siteAddressPostcode: 'LS1 1AB'
      })
    ).toEqual(['1 Main St, Leeds, LS1 1AB'])
  })

  test('keeps a flat postcode that is not part of the address string', () => {
    expect(
      buildSiteAddressLines({
        siteAddress: '1 Main St, Leeds',
        siteAddressPostcode: 'LS1 1AB'
      })
    ).toEqual(['1 Main St, Leeds', 'LS1 1AB'])
  })

  test('returns the postcode alone when there is no address', () => {
    expect(buildSiteAddressLines({ siteAddressPostcode: 'LS1 1AB' })).toEqual([
      'LS1 1AB'
    ])
  })

  test('returns an empty list when there is nothing to show', () => {
    expect(buildSiteAddressLines({})).toEqual([])
    expect(buildSiteAddressLines(undefined)).toEqual([])
  })
})

describe('#buildBusinessPlanPairs', () => {
  test('emits one pair per populated category, in the declared order', () => {
    const pairs = buildBusinessPlanPairs({
      newUsesPercent: 10,
      newInfrastructurePercent: 80,
      newInfrastructureDetail: 'Sorting line'
    })
    expect(pairs).toEqual([
      {
        label: 'New infrastructure',
        percent: '80% of PRN income',
        detail: 'Sorting line'
      },
      { label: 'New uses', percent: '10% of PRN income', detail: null }
    ])
  })

  test('emits a detail-only pair when there is no percentage', () => {
    expect(buildBusinessPlanPairs({ priceSupportDetail: 'Subsidy' })).toEqual([
      { label: 'Price support', percent: null, detail: 'Subsidy' }
    ])
  })

  test('keeps a zero percentage — 0% is a real answer, not an absent one', () => {
    expect(buildBusinessPlanPairs({ communicationsPercent: 0 })).toEqual([
      { label: 'Communications', percent: '0% of PRN income', detail: null }
    ])
  })

  test('returns an empty list for an absent or empty business plan', () => {
    expect(buildBusinessPlanPairs(null)).toEqual([])
    expect(buildBusinessPlanPairs({})).toEqual([])
  })
})

describe('#isExporterApplication (RA-295 AC02 items 9 & 10)', () => {
  test('is false for a reprocessor — no overseas sites declared', () => {
    expect(isExporterApplication(REPROCESSOR)).toBe(false)
  })

  test('is false when the payload carries an empty overseasSites list', () => {
    // The operator backend emits `overseasSites` unconditionally, degrading
    // to `{ sites: [] }` for reprocessors — so its mere presence must not
    // flip the conditional.
    expect(
      isExporterApplication({ payload: { overseasSites: { sites: [] } } })
    ).toBe(false)
  })

  test('is true once at least one overseas reprocessing site is declared', () => {
    expect(isExporterApplication(EXPORTER)).toBe(true)
  })

  test('is false for absent / malformed payloads rather than throwing', () => {
    expect(isExporterApplication(undefined)).toBe(false)
    expect(isExporterApplication({})).toBe(false)
    expect(isExporterApplication({ payload: {} })).toBe(false)
    expect(
      isExporterApplication({ payload: { overseasSites: { sites: 'nope' } } })
    ).toBe(false)
  })
})

describe('#buildApplicationSummary (RA-295 AC02)', () => {
  test('emits the eight reprocessor rows in the literal AC02 order', () => {
    const { rows, isExporter } = buildApplicationSummary({
      workItem: REPROCESSOR
    })

    expect(isExporter).toBe(false)
    expect(rows.map((r) => r.key)).toEqual([
      'site-address',
      'type',
      'material',
      'prn-tonnage',
      'prn-authorisers',
      'authority-to-issue',
      'sampling-inspection-plan',
      'business-plan'
    ])
  })

  test('appends BES then ORS, in that order, for an exporter', () => {
    const { rows, isExporter } = buildApplicationSummary({ workItem: EXPORTER })

    expect(isExporter).toBe(true)
    expect(rows.map((r) => r.key).slice(-2)).toEqual(['bes', 'ors'])

    const bes = row(rows, 'bes')
    expect(bes.sites[0].files).toHaveLength(1)
    expect(bes.sites[0].files[0].filename).toBe('bes-evidence.pdf')
    // BES is about the evidence, so the site's postal address is left to ORS.
    expect(bes.sites[0].siteAddress).toBeNull()

    const ors = row(rows, 'ors')
    expect(ors.sites[0].siteAddress).toBe('1 Overseas Lane, Rotterdam')
    expect(ors.sites[0].country).toBe('Netherlands')
    expect(ors.sites[0].files).toEqual([])
  })

  test('describes the type as applicant kind plus the registry display name', () => {
    expect(
      row(buildApplicationSummary({ workItem: REPROCESSOR }).rows, 'type')
        .values
    ).toEqual(['Reprocessor', 'Re-accreditation'])
    expect(
      row(buildApplicationSummary({ workItem: EXPORTER }).rows, 'type').values
    ).toEqual(['Exporter', 'Re-accreditation'])
  })

  test('falls back to the type id, then an em dash, when there is no display name', () => {
    expect(
      row(
        buildApplicationSummary({
          workItem: { typeId: 'mystery', payload: {} }
        }).rows,
        'type'
      ).values
    ).toEqual(['Reprocessor', 'mystery'])
    expect(
      row(buildApplicationSummary({ workItem: { payload: {} } }).rows, 'type')
        .values
    ).toEqual(['Reprocessor', EM_DASH])
  })

  test('shows the material display label, not the raw token', () => {
    expect(
      row(buildApplicationSummary({ workItem: REPROCESSOR }).rows, 'material')
        .value
    ).toBe('Plastic')
    expect(
      row(
        buildApplicationSummary({ workItem: { payload: {} } }).rows,
        'material'
      ).value
    ).toBe(EM_DASH)
  })

  test('lists PRN authorisers by name and authority-to-issue with contact detail', () => {
    const { rows } = buildApplicationSummary({ workItem: REPROCESSOR })
    expect(row(rows, 'prn-authorisers').values).toEqual([
      'Harry Edge',
      'Rosina Campbell'
    ])
    expect(row(rows, 'authority-to-issue').values).toEqual([
      'Harry Edge (harry@example.com)',
      'Rosina Campbell (rosina@example.com)'
    ])
  })

  test('falls back to the email, then an em dash, for a nameless authoriser', () => {
    const { rows } = buildApplicationSummary({
      workItem: {
        payload: { prns: { authorisers: [{ email: 'x@example.com' }, {}] } }
      }
    })
    expect(row(rows, 'prn-authorisers').values).toEqual([
      'x@example.com',
      EM_DASH
    ])
    expect(row(rows, 'authority-to-issue').values).toEqual([
      'x@example.com',
      EM_DASH
    ])
  })

  test('prefers an explicit authority-to-issue list over the authorisers', () => {
    const { rows } = buildApplicationSummary({
      workItem: {
        payload: {
          prns: {
            authorityToIssue: ['Dana Scully', { fullName: 'Fox Mulder' }],
            authorisers: [{ fullName: 'Harry Edge' }]
          }
        }
      }
    })
    expect(row(rows, 'authority-to-issue').values).toEqual([
      'Dana Scully',
      'Fox Mulder'
    ])
  })

  test('accepts an explicit authority-to-issue supplied as a single string', () => {
    const { rows } = buildApplicationSummary({
      workItem: { payload: { authorityToIssue: '  Dana Scully  ' } }
    })
    expect(row(rows, 'authority-to-issue').values).toEqual(['Dana Scully'])
  })

  test('ignores a blank explicit authority-to-issue and falls back', () => {
    const { rows } = buildApplicationSummary({
      workItem: {
        payload: {
          authorityToIssue: '   ',
          prns: { authorisers: [{ fullName: 'Harry Edge' }] }
        }
      }
    })
    expect(row(rows, 'authority-to-issue').values).toEqual(['Harry Edge'])
  })

  test('ignores an empty explicit authority-to-issue array and falls back', () => {
    const { rows } = buildApplicationSummary({
      workItem: {
        payload: {
          prns: {
            authorityToIssue: [],
            authorisers: [{ fullName: 'Harry Edge' }]
          }
        }
      }
    })
    expect(row(rows, 'authority-to-issue').values).toEqual(['Harry Edge'])
  })

  test('lists EVERY supporting document, with download links only for clean files', () => {
    const { rows } = buildApplicationSummary({ workItem: REPROCESSOR })
    const files = row(rows, 'sampling-inspection-plan').files

    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({
      filename: 'sampling-plan.pdf',
      href: '/work-items/w-1/files/f-1/download',
      scanStatus: 'Clean',
      scanTagClass: 'govuk-tag--green'
    })
    // "S&I updated by" metadata is retained.
    expect(files[0].uploadedAt).toBe('1 June 2026 at 11:00am')
    expect(files[0].uploadedBy).toBeNull()

    // A file that has not passed the virus scan is listed but not linked.
    expect(files[1]).toMatchObject({
      filename: 'inspection-notes.pdf',
      href: null,
      scanStatus: 'Pending',
      scanTagClass: 'govuk-tag--grey',
      uploadedBy: 'Priya Sharma'
    })
  })

  test('flags an infected file in red and never links it', () => {
    const { rows } = buildApplicationSummary({
      workItem: {
        id: 'w-1',
        payload: {
          samplingPlan: {
            files: [
              { fileId: 'f-9', filename: 'bad.pdf', scanStatus: 'Infected' }
            ]
          }
        }
      }
    })
    expect(row(rows, 'sampling-inspection-plan').files[0]).toMatchObject({
      href: null,
      scanStatus: 'Infected',
      scanTagClass: 'govuk-tag--red'
    })
  })

  test('handles a file with no id, name or scan status without throwing', () => {
    const { rows } = buildApplicationSummary({
      workItem: { id: 'w-1', payload: { samplingPlan: { files: [{}] } } }
    })
    expect(row(rows, 'sampling-inspection-plan').files[0]).toMatchObject({
      filename: EM_DASH,
      href: null,
      scanStatus: 'Pending',
      uploadedAt: null,
      uploadedBy: null
    })
  })

  test('yields empty collections rather than throwing on an empty work item', () => {
    const { rows } = buildApplicationSummary({ workItem: undefined })
    expect(row(rows, 'site-address').values).toEqual([])
    expect(row(rows, 'prn-authorisers').values).toEqual([])
    expect(row(rows, 'sampling-inspection-plan').files).toEqual([])
    expect(row(rows, 'business-plan').pairs).toEqual([])
    expect(row(rows, 'prn-tonnage').value).toBe(EM_DASH)
  })

  test('names an overseas site with an em dash when it has none', () => {
    const { rows } = buildApplicationSummary({
      workItem: { payload: { overseasSites: { sites: [{}] } } }
    })
    expect(row(rows, 'ors').sites[0]).toMatchObject({
      siteName: EM_DASH,
      country: null,
      siteAddress: null
    })
    expect(row(rows, 'bes').sites[0].files).toEqual([])
  })
})

describe('#buildCaseFooterRows (RA-295: reference retained at the bottom)', () => {
  test('emits the application reference and work item id first', () => {
    const rows = buildCaseFooterRows({ workItem: REPROCESSOR })
    expect(rows.slice(0, 2)).toEqual([
      {
        key: 'application-reference',
        label: 'Application reference',
        value: 'RA-2026-00001'
      },
      { key: 'work-item-id', label: 'Work item ID', value: 'w-1' }
    ])
  })

  test('omits rows with no value rather than rendering an em dash', () => {
    const rows = buildCaseFooterRows({ workItem: { payload: {} } })
    expect(rows.map((r) => r.key)).not.toContain('application-reference')
    expect(rows.map((r) => r.key)).not.toContain('operator-email')
  })

  test('keeps a zero compliance-issues count — 0 is a real answer', () => {
    const rows = buildCaseFooterRows({
      workItem: { payload: { complianceIssuesReported: 0 } }
    })
    expect(rows).toEqual([
      {
        key: 'compliance-issues-reported',
        label: 'Compliance issues reported',
        value: '0'
      }
    ])
  })

  test('joins the submitted-by declaration into one line, skipping blanks', () => {
    const rows = buildCaseFooterRows({
      workItem: {
        payload: {
          submittedBy: { fullName: 'Priya Sharma', email: 'priya@example.com' }
        }
      }
    })
    expect(rows).toContainEqual({
      key: 'declaration',
      label: 'Declaration',
      value: 'Priya Sharma, priya@example.com'
    })
  })

  test('omits the declaration entirely when submittedBy carries nothing', () => {
    const rows = buildCaseFooterRows({
      workItem: { payload: { submittedBy: {} } }
    })
    expect(rows.map((r) => r.key)).not.toContain('declaration')
  })

  test('formats the envelope timestamps', () => {
    const rows = buildCaseFooterRows({
      workItem: {
        submittedAt: '2026-04-27T09:00:00Z',
        lastModifiedAt: '2026-04-27T09:05:00Z',
        payload: {}
      }
    })
    expect(rows).toContainEqual({
      key: 'submitted-at',
      label: 'Submitted at',
      value: '27 April 2026 at 10:00am'
    })
    expect(rows).toContainEqual({
      key: 'last-modified',
      label: 'Last modified',
      value: '27 April 2026 at 10:05am'
    })
  })

  test('tolerates an absent work item', () => {
    expect(buildCaseFooterRows({})).toEqual([])
  })
})
