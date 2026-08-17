import { describe, expect, test } from 'vitest'

import { realOperatorSubmissionPayload } from '#/test-helpers/real-operator-submission-payload.js'
import { buildCaseHeader } from './case-header.js'
import {
  buildApplicationSummary,
  buildAuthorityToIssueContacts,
  buildBusinessPlanPairs,
  buildCaseFooterRows,
  buildInterimSite,
  buildOverseasSite,
  buildSiteAddressLines,
  isExporterApplication,
  isFlaggedNew,
  toDisplayLines,
  tonnageBandLabel
} from './application-summary.js'

const EM_DASH = '—'

function row(rows, key) {
  return rows.find((r) => r.key === key)
}

// RA-292 turned the authority-to-issue row from flat strings into a contact
// per authoriser. The rendered text is unchanged, so the pre-RA-292
// expectations are kept verbatim and reconstituted here — which is the point:
// if the rendering ever diverges from "Name (email)" these fail.
function authorityLines(rows) {
  return row(rows, 'authority-to-issue').contacts.map((contact) =>
    contact.email ? `${contact.name} (${contact.email})` : contact.name
  )
}

// A named detail field's display lines, or undefined when the field was
// omitted (which is how absent data is represented — there is no placeholder
// row).
function orsDetail(site, key) {
  return site.details.find((detail) => detail.key === key)?.values
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
      plannedTonnageBand: 'UpTo5000',
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
    wasteProcessingType: 'exporter',
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
    expect(tonnageBandLabel('UpTo5000')).toBe('Up to 5,000 tonnes')
    expect(tonnageBandLabel('UpTo10000')).toBe('Up to 10,000 tonnes')
    expect(tonnageBandLabel('Over10000')).toBe('More than 10,000 tonnes')
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

describe('#isExporterApplication (RA-412: real wasteProcessingType field)', () => {
  test('is false for a reprocessor', () => {
    expect(isExporterApplication(REPROCESSOR)).toBe(false)
  })

  test('is true for an exporter', () => {
    expect(isExporterApplication(EXPORTER)).toBe(true)
  })

  test("is case-insensitive, matching management-be's own comparison", () => {
    expect(
      isExporterApplication({ payload: { wasteProcessingType: 'Exporter' } })
    ).toBe(true)
    expect(
      isExporterApplication({ payload: { wasteProcessingType: 'EXPORTER' } })
    ).toBe(true)
  })

  // RA-412 fixed both directions of the old `overseasSites`-based proxy's
  // wrong answers — pinned here so neither regresses.
  test('is true for an Exporter with no overseas sites declared yet', () => {
    // AC02 items 9-10 require BES/ORS to be shown for this application; the
    // old proxy hid them, because "declared an overseas site" is not the
    // same question as "is an Exporter".
    const exporterBeforeAddingSites = {
      typeId: 're-accreditation',
      payload: {
        organisationName: 'Exporter Ltd',
        wasteProcessingType: 'exporter',
        overseasSites: { sites: [] }
      }
    }
    expect(isExporterApplication(exporterBeforeAddingSites)).toBe(true)
  })

  test('is false for a Reprocessor that happens to carry overseas sites', () => {
    // The mirror-image case: AC02 forbids showing BES/ORS here.
    const reprocessorWithSites = {
      typeId: 're-accreditation',
      payload: {
        organisationName: 'Reprocessor Ltd',
        wasteProcessingType: 'reprocessor',
        overseasSites: { sites: [{ siteName: 'X' }] }
      }
    }
    expect(isExporterApplication(reprocessorWithSites)).toBe(false)
  })

  // Pre-RA-314 work items carry no `wasteProcessingType` at all — treated as
  // a reprocessor, matching how every such item already rendered.
  test('is false for absent / malformed payloads rather than throwing', () => {
    expect(isExporterApplication(undefined)).toBe(false)
    expect(isExporterApplication({})).toBe(false)
    expect(isExporterApplication({ payload: {} })).toBe(false)
    expect(
      isExporterApplication({ payload: { wasteProcessingType: null } })
    ).toBe(false)
    expect(
      isExporterApplication({ payload: { wasteProcessingType: 123 } })
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
    // RA-292 made that structural rather than a nulled field: the BES row's
    // view model has no address at all.
    expect(bes.sites[0]).not.toHaveProperty('siteAddress')

    const ors = row(rows, 'ors')
    // The country is the last part of the address now, not a field of its
    // own — it used to sit on the site-name line in parentheses.
    expect(ors.sites[0].addressLines).toEqual([
      '1 Overseas Lane, Rotterdam',
      'Netherlands'
    ])
  })

  test('describes the type using the registry display name alone', () => {
    expect(
      row(buildApplicationSummary({ workItem: REPROCESSOR }).rows, 'type').value
    ).toBe('Re-accreditation')
  })

  // RA-434-processortype: the "Type" row deliberately still carries no
  // applicant-kind prefix — see the comment on that row in
  // application-summary.js. Restoring one is a product/BA decision, not
  // made here.
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

  test('appends the glass recycling type suffix to the material row', () => {
    const workItem = {
      ...REPROCESSOR,
      payload: {
        ...REPROCESSOR.payload,
        material: 'glass',
        glassRecyclingProcess: 'glass_re_melt'
      }
    }
    expect(
      row(buildApplicationSummary({ workItem }).rows, 'material').value
    ).toBe('Glass - Remelt')
  })

  test('lists PRN authorisers by name and authority-to-issue with contact detail', () => {
    const { rows } = buildApplicationSummary({ workItem: REPROCESSOR })
    expect(row(rows, 'prn-authorisers').values).toEqual([
      'Harry Edge',
      'Rosina Campbell'
    ])
    expect(authorityLines(rows)).toEqual([
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
    expect(authorityLines(rows)).toEqual(['x@example.com', EM_DASH])
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
    expect(authorityLines(rows)).toEqual(['Harry Edge (harry@example.com)'])
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
      workItem: {
        payload: {
          wasteProcessingType: 'exporter',
          overseasSites: { sites: [{}] }
        }
      }
    })
    expect(row(rows, 'ors').sites[0]).toMatchObject({
      siteName: EM_DASH,
      isNew: false,
      addressLines: [],
      details: [],
      interimSite: null
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
    expect(row(rows, 'prn-tonnage').value).toBe('Up to 5,000 tonnes')
    expect(row(rows, 'prn-authorisers').values).toEqual(['Bob Jones'])
    expect(authorityLines(rows)).toEqual(['Bob Jones (bob@example.com)'])

    const files = row(rows, 'sampling-inspection-plan').files
    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('sampling-plan.pdf')
    expect(files[0].uploadedAt).toBe('5 January 2026 at 10:00am')
    // The download href is built from `payload.samplingPlan.files[].fileId`.
    // Asserting the resolved href — not just that the file is listed — is what
    // makes a rename of `fileId` on the producer fail here rather than ship a
    // Clean document with no way to open it.
    expect(files[0].href).toBe(
      '/work-items/w-1/files/file-sampling-001/download'
    )

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

    // A reprocessor submission carries `overseasSites` present-and-EMPTY, so
    // BES/ORS stay hidden because the site list is empty — not because the key
    // is missing from the fixture. Pinned so the distinction cannot rot.
    expect(workItem.payload.overseasSites).toEqual({ sites: [] })
    expect(workItem.payload.wasteProcessingType).toBe('reprocessor')
    expect(isExporterApplication(workItem)).toBe(false)
    expect(rows.map((r) => r.key)).not.toContain('bes')
    expect(rows.map((r) => r.key)).not.toContain('ors')
  })

  test('no AC02 row silently degrades to an em dash against the real payload', () => {
    const { rows } = buildApplicationSummary({ workItem })
    for (const r of rows) {
      if (r.kind === 'text') expect(r.value).not.toBe(EM_DASH)
      if (r.kind === 'lines') {
        // Length alone is not enough: `authoriserName` returns the em dash
        // PER ENTRY, so a producer rename yields `['—']` — length 1, green.
        expect(r.values.length).toBeGreaterThan(0)
        expect(r.values).not.toContain(EM_DASH)
      }
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

// ---------------------------------------------------------------------------
// RA-292. New ORS / interim site / authority-to-issue contact.
//
// The tests below are organised around the ONE rule the story turns on: only
// an explicit `true` is new. Every acceptance criterion is a rendering of that
// rule plus the detail a regulator needs to act on it, and every RA-292 field
// is optional — work items submitted before the story carry none of them, so
// absent, null and empty each have to be a first-class case rather than an
// afterthought.
// ---------------------------------------------------------------------------

describe('#isFlaggedNew (RA-292: the new-flag rule)', () => {
  test('only an explicit true is new', () => {
    expect(isFlaggedNew(true)).toBe(true)
  })

  test.each([
    ['false', false],
    ['null', null],
    ['undefined', undefined],
    ['absent (no property)', {}.isNewSite],
    ['zero', 0],
    ['empty string', '']
  ])('%s is not new', (_label, value) => {
    expect(isFlaggedNew(value)).toBe(false)
  })

  // The failure this guards against is silent and total: a serialiser that
  // starts emitting the flag as a string would make EVERY site "new" under a
  // truthiness test, including the ones carrying "false". A regulator would
  // then have no way to tell which sites actually need scrutiny — the badge
  // would be pure noise — and nothing would error. Failing closed is wrong in
  // the safe direction and visible here.
  test('the STRING "false" is not new — and neither is the string "true"', () => {
    expect(isFlaggedNew('false')).toBe(false)
    expect(isFlaggedNew('true')).toBe(false)
  })
})

describe('#toDisplayLines (RA-292: wire value -> display lines)', () => {
  test('drops absent values entirely, so the field renders no row at all', () => {
    expect(toDisplayLines(null)).toEqual([])
    expect(toDisplayLines(undefined)).toEqual([])
  })

  test('trims strings and drops blank ones', () => {
    expect(toDisplayLines('  Rotterdam  ')).toEqual(['Rotterdam'])
    expect(toDisplayLines('   ')).toEqual([])
  })

  // The trap mgmt-tests flagged. `repatriatedLoads: 0` and
  // `registeredNowAccredited: false` are ANSWERS, not missing data, and a
  // truthiness-based omit rule would drop exactly those two from a
  // regulator's review while leaving every other field in place.
  test('keeps zero and false — they are answers, not absences', () => {
    expect(toDisplayLines(0)).toEqual(['0'])
    expect(toDisplayLines(false)).toEqual(['No'])
    expect(toDisplayLines(true)).toEqual(['Yes'])
  })

  test('renders finite numbers and drops non-finite ones', () => {
    expect(toDisplayLines(3)).toEqual(['3'])
    expect(toDisplayLines(Number.NaN)).toEqual([])
    expect(toDisplayLines(Number.POSITIVE_INFINITY)).toEqual([])
  })

  test('flattens arrays, dropping the empty entries', () => {
    expect(toDisplayLines(['One', '', null, 'Two'])).toEqual(['One', 'Two'])
    expect(toDisplayLines([])).toEqual([])
  })

  // "[object Object]" on a regulator's case screen is worse than nothing: it
  // looks like real data and hides that a field was never mapped.
  test('contributes nothing for an unmapped object shape', () => {
    expect(toDisplayLines({ unexpected: 'shape' })).toEqual([])
  })
})

describe('#buildOverseasSite (RA-292 AC01 + AC04)', () => {
  // Mirrors the management-be seed's site[0] "Rotterdam" — the item that
  // carries every field, so it is the one that proves AC04 in full.
  const FULL_SITE = {
    siteId: 1,
    orsId: 'ORS-2026-0292',
    siteName: 'Rotterdam New Reprocessing Site',
    siteAddress: '1 Havenstraat, Rotterdam',
    addressLine1: '1 Havenstraat',
    addressLine2: 'Europoort Industrial Park',
    townOrCity: 'Rotterdam',
    country: 'Netherlands',
    coordinates: '51.9244, 4.4777',
    contactName: 'Johan de Vries',
    contactEmail: 'johan@example.com',
    contactPhone: '+31 10 123 4567',
    operationCode: 'R3',
    code1: 'B3011',
    code2: 'GH013',
    code3: 'Y48',
    repatriatedLoads: 3,
    conditionsOfExport: true,
    isNewSite: true,
    registeredNowAccredited: false,
    isEu: true,
    isOecd: true
  }

  test('AC01: flags a site whose isNewSite is true', () => {
    expect(buildOverseasSite(FULL_SITE).isNew).toBe(true)
  })

  test.each([
    ['false', false],
    ['null', null],
    ['absent', undefined]
  ])(
    'AC01: does not flag a site whose isNewSite is %s',
    (_label, isNewSite) => {
      expect(buildOverseasSite({ ...FULL_SITE, isNewSite }).isNew).toBe(false)
    }
  )

  test('AC04: surfaces every site field, in reading order, with its label', () => {
    const { details, addressLines } = buildOverseasSite(FULL_SITE)

    // The design puts the address on its own unlabelled line beneath the site
    // name, so it is NOT a labelled detail row.
    expect(addressLines).toEqual([
      '1 Havenstraat',
      'Europoort Industrial Park',
      'Rotterdam',
      'Netherlands'
    ])
    expect(details.map((detail) => [detail.key, detail.values])).toEqual([
      ['ors-id', ['ORS-2026-0292']],
      ['coordinates', ['51.9244, 4.4777']],
      ['contact-name', ['Johan de Vries']],
      ['contact-email', ['johan@example.com']],
      ['contact-phone', ['+31 10 123 4567']],
      ['operation-code', ['R3']],
      ['waste-codes', ['B3011, GH013, Y48']],
      ['repatriated-loads', ['3']],
      ['conditions-of-export', ['Yes']],
      ['registered-now-accredited', ['No']],
      ['eu-country', ['Yes']],
      ['oecd-country', ['Yes']]
    ])
    expect(details.find((detail) => detail.key === 'waste-codes').label).toBe(
      'Basel/OECD codes'
    )
  })

  // Pins the two falsy-but-real values against the omit rule, at the level a
  // reader will check when they suspect a field went missing.
  test('AC04: keeps repatriatedLoads 0 and registeredNowAccredited false', () => {
    const site = buildOverseasSite({
      ...FULL_SITE,
      repatriatedLoads: 0,
      registeredNowAccredited: false,
      isEu: false,
      isOecd: false
    })
    expect(orsDetail(site, 'repatriated-loads')).toEqual(['0'])
    expect(orsDetail(site, 'registered-now-accredited')).toEqual(['No'])
    expect(orsDetail(site, 'eu-country')).toEqual(['No'])
    expect(orsDetail(site, 'oecd-country')).toEqual(['No'])
  })

  test('omits fields the site does not carry rather than padding with em dashes', () => {
    // The seed's near-minimal "Bilbao" site.
    const site = buildOverseasSite({
      siteId: 3,
      orsId: 'ORS-2026-0003',
      siteName: 'Bilbao Legacy Reprocessing Site',
      siteAddress: 'Calle Uno, Bilbao',
      townOrCity: 'Bilbao',
      country: 'Spain'
    })
    expect(site.details.map((detail) => detail.key)).toEqual(['ors-id'])
    expect(site.addressLines).toEqual(['Calle Uno, Bilbao', 'Spain'])
    expect(site.isNew).toBe(false)
    expect(site.interimSite).toBeNull()
  })

  test('names an unnamed site with an em dash and leaves country null', () => {
    expect(buildOverseasSite({})).toEqual({
      siteName: EM_DASH,
      isNew: false,
      addressLines: [],
      details: [],
      interimSite: null
    })
  })

  test('survives a null entry in the sites array', () => {
    expect(buildOverseasSite(null).siteName).toBe(EM_DASH)
    expect(buildOverseasSite(undefined).details).toEqual([])
  })

  describe('address', () => {
    test('uses the structured lines when addressLine1 is present', () => {
      const site = buildOverseasSite({
        siteAddress: '1 Havenstraat, Rotterdam',
        addressLine1: '1 Havenstraat',
        townOrCity: 'Rotterdam'
      })
      // The flat string is NOT appended: it says the same thing, and printing
      // an address twice on a review screen reads as two addresses.
      expect(site.addressLines).toEqual(['1 Havenstraat', 'Rotterdam'])
    })

    // The case that makes "structured wins if non-empty" wrong. Without
    // addressLine1 the structured fields are just a town, so leading with
    // them would drop the street from the regulator's view of the site.
    test('leads with the flat string when addressLine1 is missing', () => {
      const site = buildOverseasSite({
        siteAddress: 'Calle Uno, Bilbao',
        townOrCity: 'Bilbao'
      })
      expect(site.addressLines).toEqual(['Calle Uno, Bilbao'])
    })

    test('appends a structured part the flat string does not already contain', () => {
      const site = buildOverseasSite({
        siteAddress: 'Calle Uno',
        townOrCity: 'Bilbao'
      })
      expect(site.addressLines).toEqual(['Calle Uno', 'Bilbao'])
    })

    // A substring test would drop "York" as already present in "New York
    // Road" and lose the town entirely. Segment-exact comparison keeps it.
    test('keeps a structured part that is merely a substring of the flat one', () => {
      const site = buildOverseasSite({
        siteAddress: '14 New York Road',
        townOrCity: 'York'
      })
      expect(site.addressLines).toEqual(['14 New York Road', 'York'])
    })

    test('matches a repeated segment regardless of case and padding', () => {
      const site = buildOverseasSite({
        siteAddress: 'Calle Uno,  BILBAO ',
        townOrCity: 'Bilbao'
      })
      expect(site.addressLines).toEqual(['Calle Uno,  BILBAO'])
    })

    // The country is appended through the SAME segment-wise de-duplication as
    // everything else. A legacy flat `siteAddress` routinely already ends with
    // the country, and "…, Netherlands, Netherlands" is exactly the kind of
    // duplication nobody notices in review.
    test('does not repeat a country the flat address already ends with', () => {
      const site = buildOverseasSite({
        siteAddress: '1 Havenstraat, Rotterdam, Netherlands',
        country: 'Netherlands'
      })
      expect(site.addressLines).toEqual([
        '1 Havenstraat, Rotterdam, Netherlands'
      ])
    })

    test('appends the country when the address does not already carry it', () => {
      const site = buildOverseasSite({
        addressLine1: '1 Havenstraat',
        townOrCity: 'Rotterdam',
        country: 'Netherlands'
      })
      expect(site.addressLines).toEqual([
        '1 Havenstraat',
        'Rotterdam',
        'Netherlands'
      ])
    })

    // THE INVARIANT, stated as tests: de-duplication reconciles the legacy
    // flat string against the structured fields, and NEVER compares two
    // structured fields with each other.
    //
    // A flat string repeating a structured value is an artefact — one address
    // in two representations. Two structured fields agreeing is a fact. These
    // two tests are the pair that keeps that distinction from being
    // "simplified" into a single tidy-looking rule.
    test.each([['Singapore'], ['Luxembourg'], ['Monaco'], ['Djibouti']])(
      'keeps the country when the city shares its name (%s)',
      (cityAndCountry) => {
        const site = buildOverseasSite({
          addressLine1: '1 Main St',
          townOrCity: cityAndCountry,
          country: cityAndCountry
        })
        // Both render. For an OVERSEAS reprocessing site the country is the
        // field a regulator most needs, and an earlier revision dropped it
        // here — output that looked tidy and was data loss.
        expect(site.addressLines).toEqual([
          '1 Main St',
          cityAndCountry,
          cityAndCountry
        ])
      }
    )

    test('falls back to the structured parts when there is no flat string', () => {
      const site = buildOverseasSite({ townOrCity: 'Bilbao' })
      expect(site.addressLines).toEqual(['Bilbao'])
    })

    test('yields no address lines when the site has no address at all', () => {
      expect(buildOverseasSite({ siteName: 'X' }).addressLines).toEqual([])
    })
  })

  describe('coordinates', () => {
    // A pre-formatted string on the wire, confirmed against a captured
    // payload — not a {lat,long} pair.
    test('passes the pre-formatted string through', () => {
      const site = buildOverseasSite({ coordinates: '48.8566,2.3522' })
      expect(orsDetail(site, 'coordinates')).toEqual(['48.8566,2.3522'])
    })

    test('omits the row when absent', () => {
      expect(orsDetail(buildOverseasSite({}), 'coordinates')).toBeUndefined()
    })
  })

  describe('waste codes', () => {
    test('joins only the codes that are present', () => {
      const site = buildOverseasSite({ code1: 'B3011', code3: 'Y48' })
      expect(orsDetail(site, 'waste-codes')).toEqual(['B3011, Y48'])
    })

    test('omits the row when no code is present', () => {
      expect(orsDetail(buildOverseasSite({}), 'waste-codes')).toBeUndefined()
    })
  })
})

describe('#buildInterimSite (RA-292 AC02 + AC04)', () => {
  const INTERIM = {
    siteId: 9,
    siteNumber: 'INT-001',
    isNewSite: true,
    country: 'Belgium',
    siteName: 'Antwerp Interim Holding Site',
    addressLine1: '4 Scheldelaan',
    addressLine2: 'Dock 7',
    townOrCity: 'Antwerp',
    stateOrRegion: 'Flanders',
    postcode: '2030',
    contactName: 'Marieke Peeters',
    contactEmail: 'marieke@example.com',
    contactPhone: '+32 3 555 0100'
  }

  test('AC02: flags an interim site whose isNewSite is true', () => {
    expect(buildInterimSite(INTERIM).isNew).toBe(true)
  })

  test.each([
    ['false', false],
    ['null', null],
    ['absent', undefined]
  ])(
    'AC02: does not flag an interim site whose isNewSite is %s',
    (_label, isNewSite) => {
      expect(buildInterimSite({ ...INTERIM, isNewSite }).isNew).toBe(false)
    }
  )

  test('AC04: surfaces the interim detail, with the address as one block', () => {
    const site = buildInterimSite(INTERIM)
    expect(site.siteName).toBe('Antwerp Interim Holding Site')
    // Country is the last part of the address, matching the ORS ordering.
    expect(site.addressLines).toEqual([
      '4 Scheldelaan',
      'Dock 7',
      'Antwerp',
      'Flanders',
      '2030',
      'Belgium'
    ])
    expect(site.details.map((detail) => [detail.key, detail.values])).toEqual([
      ['site-number', ['INT-001']],
      ['contact-name', ['Marieke Peeters']],
      ['contact-email', ['marieke@example.com']],
      ['contact-phone', ['+32 3 555 0100']]
    ])
  })

  test('skips an address line the interim site does not carry', () => {
    // The seed's site[1] interim site has no addressLine2.
    const site = buildInterimSite({ ...INTERIM, addressLine2: null })
    expect(site.addressLines).toEqual([
      '4 Scheldelaan',
      'Antwerp',
      'Flanders',
      '2030',
      'Belgium'
    ])
  })

  // The producer omits the key entirely rather than sending null (its
  // serialiser drops null-valued fields), so "absent" is the case that
  // actually occurs — but absent and null must not diverge into two
  // behaviours here, so both are pinned.
  // Bremen is a German city-state, so `townOrCity` and `stateOrRegion` are
  // both correctly "Bremen". Both render: the interim shape has no legacy flat
  // string, so by the de-duplication invariant there is nothing to reconcile
  // and nothing to drop. Raised by the mgmt-tests teammate, and pinned here so
  // the behaviour is a decision rather than a side effect.
  test('preserves a genuine repeat — a city-state whose town and region match', () => {
    const site = buildInterimSite({
      addressLine1: '8 Speicherstrasse',
      townOrCity: 'Bremen',
      stateOrRegion: 'Bremen',
      postcode: '28217',
      country: 'Germany'
    })
    expect(site.addressLines).toEqual([
      '8 Speicherstrasse',
      'Bremen',
      'Bremen',
      '28217',
      'Germany'
    ])
  })

  test.each([
    ['absent', undefined],
    ['null', null],
    ['a non-object', 'Antwerp']
  ])('yields null for %s, so no interim block is rendered', (_label, value) => {
    expect(buildInterimSite(value)).toBeNull()
  })

  test('names an unnamed interim site with an em dash', () => {
    expect(buildInterimSite({})).toEqual({
      siteName: EM_DASH,
      isNew: false,
      addressLines: [],
      details: []
    })
  })

  test('nests under its parent ORS rather than standing beside it', () => {
    const { rows } = buildApplicationSummary({
      workItem: {
        payload: {
          wasteProcessingType: 'exporter',
          overseasSites: {
            sites: [{ siteName: 'Rotterdam', interimSite: INTERIM }]
          }
        }
      }
    })
    const sites = row(rows, 'ors').sites
    expect(sites).toHaveLength(1)
    expect(sites[0].interimSite.siteName).toBe('Antwerp Interim Holding Site')
  })
})

describe('#buildAuthorityToIssueContacts (RA-292 AC03)', () => {
  test('AC03: flags only the contact whose isNew is true', () => {
    // The seed's three authorisers: true, false and absent.
    const contacts = buildAuthorityToIssueContacts({
      authorisers: [
        { fullName: 'Grace Adeyemi', email: 'grace@example.com', isNew: true },
        { fullName: 'Martin Cole', email: 'martin@example.com', isNew: false },
        { fullName: 'Priya Nair', email: 'priya@example.com' }
      ]
    })
    expect(contacts.map((contact) => contact.isNew)).toEqual([
      true,
      false,
      false
    ])
    expect(contacts.map((contact) => contact.name)).toEqual([
      'Grace Adeyemi',
      'Martin Cole',
      'Priya Nair'
    ])
  })

  test('does not flag a contact whose isNew is null', () => {
    const [contact] = buildAuthorityToIssueContacts({
      authorisers: [{ fullName: 'Grace Adeyemi', isNew: null }]
    })
    expect(contact.isNew).toBe(false)
  })

  // A nameless authoriser already shows its email AS the name, so carrying
  // the email separately too would render "x@example.com (x@example.com)".
  test('suppresses the parenthetical email when the email IS the name', () => {
    expect(
      buildAuthorityToIssueContacts({ authorisers: [{ email: 'x@e.com' }] })
    ).toEqual([{ name: 'x@e.com', email: null, isNew: false }])
  })

  test('falls back to an em dash for an authoriser with neither name nor email', () => {
    expect(buildAuthorityToIssueContacts({ authorisers: [{}] })).toEqual([
      { name: EM_DASH, email: null, isNew: false }
    ])
  })

  test('keeps the email beside a named authoriser', () => {
    expect(
      buildAuthorityToIssueContacts({
        authorisers: [{ fullName: 'Grace Adeyemi', email: 'grace@example.com' }]
      })
    ).toEqual([
      { name: 'Grace Adeyemi', email: 'grace@example.com', isNew: false }
    ])
  })

  test.each([
    ['an absent prns block', undefined],
    ['a prns block with no authorisers', {}],
    ['a non-array authorisers field', { authorisers: 'Grace' }],
    ['an empty authorisers list', { authorisers: [] }]
  ])('yields no contacts for %s', (_label, prns) => {
    expect(buildAuthorityToIssueContacts(prns)).toEqual([])
  })
})

describe('RA-292 producer contract (verbatim captured payload)', () => {
  // Copied verbatim from a serialised payload captured in the producer's own
  // test — a site with only its mandatory model fields set. It is here rather
  // than paraphrased because the whole point is to catch a producer-side
  // change: the producer serialises with `WhenWritingNull`, so an optional
  // field with no value is an ABSENT KEY, never a null. Every optional field
  // below is missing, while all four booleans are present and two of them are
  // false.
  const SPARSE_SITE = {
    siteId: 3,
    siteName: 'Sparse Site',
    isEu: false,
    isOecd: false,
    isNewSite: false,
    registeredNowAccredited: false,
    besEvidence: { files: [] }
  }

  test('renders a sparse site without inventing rows for absent fields', () => {
    const site = buildOverseasSite(SPARSE_SITE)

    expect(site.siteName).toBe('Sparse Site')
    expect(site.addressLines).toEqual([])
    // A site with no stored newness arrives UNflagged. `isNewSite` used to
    // default to true on the producer's model, which meant a site carrying no
    // newness at all — a legacy work item, say — rendered as new. That is the
    // failure this badge cannot survive: a badge on everything is
    // indistinguishable from a correct one, so a regulator has no way to
    // notice it has stopped meaning anything. Now server-derived and
    // defaulting to false, so the failure direction is a MISSING badge.
    expect(site.isNew).toBe(false)
    expect(site.interimSite).toBeNull()

    // Exactly the fields that are PRESENT — and all three false booleans are
    // among them. If the omit rule ever regressed to a truthiness test these
    // three would vanish and the site would render as if it carried nothing
    // but a name.
    expect(site.details.map((detail) => [detail.key, detail.values])).toEqual([
      ['registered-now-accredited', ['No']],
      ['eu-country', ['No']],
      ['oecd-country', ['No']]
    ])
  })

  // `conditionsOfExport` is the one NULLABLE field in the set, so it is absent
  // even on otherwise-complete sites — and it is a boolean, not free text.
  test('renders conditionsOfExport as a boolean, and omits it when absent', () => {
    expect(
      orsDetail(
        buildOverseasSite({ conditionsOfExport: false }),
        'conditions-of-export'
      )
    ).toEqual(['No'])
    expect(
      orsDetail(
        buildOverseasSite({ conditionsOfExport: true }),
        'conditions-of-export'
      )
    ).toEqual(['Yes'])
    expect(
      orsDetail(buildOverseasSite({}), 'conditions-of-export')
    ).toBeUndefined()
  })

  // Strings on the wire, despite reading as a number and a coordinate pair.
  test('renders repatriatedLoads and coordinates as the strings they are', () => {
    const site = buildOverseasSite({
      repatriatedLoads: '12',
      coordinates: '48.8566,2.3522'
    })
    expect(orsDetail(site, 'repatriated-loads')).toEqual(['12'])
    expect(orsDetail(site, 'coordinates')).toEqual(['48.8566,2.3522'])
  })

  test('renders a repatriatedLoads of "0" — a string zero is still an answer', () => {
    expect(
      orsDetail(
        buildOverseasSite({ repatriatedLoads: '0' }),
        'repatriated-loads'
      )
    ).toEqual(['0'])
  })
})

describe('RA-292 backwards compatibility (pre-story work items)', () => {
  // The whole point of the story's optionality contract: items already in
  // Mongo carry NONE of the RA-292 fields, and must render exactly as they
  // did before rather than erroring or sprouting badges.
  test('a payload with no RA-292 fields renders no ORS row and no badges', () => {
    const { rows } = buildApplicationSummary({ workItem: REPROCESSOR })
    expect(row(rows, 'ors')).toBeUndefined()
    expect(row(rows, 'bes')).toBeUndefined()
    expect(
      row(rows, 'authority-to-issue').contacts.every(
        (contact) => contact.isNew === false
      )
    ).toBe(true)
  })

  test('a pre-RA-292 exporter still shows its site name and flat address', () => {
    const { rows } = buildApplicationSummary({ workItem: EXPORTER })
    const [site] = row(rows, 'ors').sites
    expect(site.siteName).toBe('Rotterdam Reprocessing')
    expect(site.isNew).toBe(false)
    expect(site.interimSite).toBeNull()
    expect(site.addressLines).toEqual([
      '1 Overseas Lane, Rotterdam',
      'Netherlands'
    ])
  })
})
