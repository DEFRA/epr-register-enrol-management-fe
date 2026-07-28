import { describe, expect, test } from 'vitest'

import { realOperatorSubmissionPayload } from '#/test-helpers/real-operator-submission-payload.js'
import { buildCaseHeader } from './case-header.js'
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

  test('describes the type using the registry display name alone', () => {
    expect(
      row(buildApplicationSummary({ workItem: REPROCESSOR }).rows, 'type').value
    ).toBe('Re-accreditation')
  })

  // The `overseasSites` proxy is safe for HIDING BES/ORS but not for
  // asserting an applicant kind: printing "Reprocessor" would be a positive
  // factual claim the backend never makes, and by that proxy's own logic an
  // exporter who has not yet added a site would be mislabelled "Reprocessor"
  // on a regulator's case screen.
  test('never claims an applicant kind the backend does not send', () => {
    for (const workItem of [REPROCESSOR, EXPORTER]) {
      const typeRow = row(buildApplicationSummary({ workItem }).rows, 'type')
      expect(typeRow.value).not.toContain('Reprocessor')
      expect(typeRow.value).not.toContain('Exporter')
    }
  })

  test('falls back to the type id, then an em dash, when there is no display name', () => {
    expect(
      row(
        buildApplicationSummary({
          workItem: { typeId: 'mystery', payload: {} }
        }).rows,
        'type'
      ).value
    ).toBe('mystery')
    expect(
      row(buildApplicationSummary({ workItem: { payload: {} } }).rows, 'type')
        .value
    ).toBe(EM_DASH)
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

  // The producer emits no separate authority-to-issue field, so the row is
  // DERIVED from the PRN authorisers. The speculative reads of
  // `prns.authorityToIssue` / `payload.authorityToIssue` were removed as
  // unreachable — this pins that they stay removed, so nobody reintroduces a
  // branch that looks like a working feature but can never fire.
  test('derives authority to issue from the PRN authorisers, ignoring speculative fields', () => {
    const { rows } = buildApplicationSummary({
      workItem: {
        payload: {
          authorityToIssue: 'Dana Scully',
          prns: {
            authorityToIssue: ['Fox Mulder'],
            authorisers: [
              { fullName: 'Harry Edge', email: 'harry@example.com' }
            ]
          }
        }
      }
    })
    expect(row(rows, 'authority-to-issue').values).toEqual([
      'Harry Edge (harry@example.com)'
    ])
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

// ---------------------------------------------------------------------
// Consumer contract (ported from the deleted application-details
// controller test by RA-295).
//
// The detail page reads MORE of the operator submission than the two-step
// page it replaced, so this guard matters more now, not less. It asserts
// against a literal copy of HttpCaseWorkingApiAdapter.BuildPayload's output
// rather than a hand-picked subset, so a field-name drift on the producer
// side fails here instead of surfacing as a blank field in CDP — which is
// exactly how `material` vs `materialsHandled` escaped.
//
// If one of these fails, fix the READER or confirm the producer genuinely
// renamed the field. Never edit the fixture to match the frontend.
// ---------------------------------------------------------------------
describe('real operator submission payload contract', () => {
  const workItem = {
    id: 'w-1',
    typeId: 're-accreditation',
    typeDisplayName: 'Re-accreditation',
    submittedAt: '2026-01-05T10:00:00Z',
    lastModifiedAt: '2026-01-06T10:00:00Z',
    submittedBy: 'stub-portal-client',
    payload: realOperatorSubmissionPayload()
  }

  test('every AC02 row resolves a real value from the adapter payload', () => {
    const { rows } = buildApplicationSummary({ workItem })

    expect(row(rows, 'site-address').values).toEqual([
      '123 High Street, London, SW1A 1AA'
    ])
    expect(row(rows, 'type').value).toBe('Re-accreditation')
    expect(row(rows, 'material').value).toBe('Plastic')
    expect(row(rows, 'prn-tonnage').value).toBe('Up to 1,000 tonnes')
    expect(row(rows, 'prn-authorisers').values).toEqual(['Bob Jones'])
    expect(row(rows, 'authority-to-issue').values).toEqual([
      'Bob Jones (bob@example.com)'
    ])

    const files = row(rows, 'sampling-inspection-plan').files
    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('sampling-plan.pdf')
    expect(files[0].uploadedAt).toBe('5 January 2026 at 10:00am')

    // All six business-plan categories are emitted by the adapter, each with
    // a percentage AND a narrative.
    const pairs = row(rows, 'business-plan').pairs
    expect(pairs).toHaveLength(6)
    expect(pairs.every((p) => p.percent !== null && p.detail !== null)).toBe(
      true
    )
    expect(pairs[0]).toEqual({
      label: 'New infrastructure',
      percent: '20% of PRN income',
      detail: 'New sorting line'
    })

    // No overseas sites in a reprocessor submission, so BES/ORS stay hidden.
    expect(rows.map((r) => r.key)).not.toContain('bes')
    expect(rows.map((r) => r.key)).not.toContain('ors')
  })

  test('no AC02 row silently degrades to an em dash against the real payload', () => {
    const { rows } = buildApplicationSummary({ workItem })
    for (const r of rows) {
      if (r.kind === 'text') expect(r.value).not.toBe(EM_DASH)
      if (r.kind === 'lines') expect(r.values.length).toBeGreaterThan(0)
    }
  })

  test('the reference block resolves every envelope and operator field', () => {
    const rows = buildCaseFooterRows({ workItem })
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))

    expect(byKey['work-item-id']).toBe('w-1')
    expect(byKey['registration-number']).toBe('EPR-100023')
    expect(byKey['accreditation-year']).toBe('2026')
    expect(byKey['previous-accreditation-year']).toBe('2025')
    expect(byKey['compliance-issues-reported']).toBe('0')
    expect(byKey['operator-application-id']).toBe('app-001')
    expect(byKey['operator-organisation-id']).toBe('12345')
    expect(byKey['operator-registration-id']).toBe('reg-001')
    expect(byKey['operator-email']).toBe('jane@example.com')
    expect(byKey.declaration).toBe(
      'Jane Smith, Operations Manager, jane@example.com'
    )
    expect(byKey['submitted-by']).toBe('stub-portal-client')
    expect(byKey['submitted-at']).toBe('5 January 2026 at 10:00am')
    expect(byKey['last-modified']).toBe('6 January 2026 at 10:00am')
  })

  test('the case header resolves org, material and registration number', () => {
    const header = buildCaseHeader({ workItem })
    expect(header.organisationName).toBe('Acme Recycling Ltd')
    expect(header.organisationId).toBe('12345')
    expect(header.meta.find((m) => m.key === 'material').value).toBe('Plastic')
    expect(header.meta.find((m) => m.key === 'registration-number').value).toBe(
      'EPR-100023'
    )
  })
})
