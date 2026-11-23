/**
 * RA-769. The Accreditation summary tab of an In-Year Change case: the
 * accreditation as it stands today, read live through management-be.
 *
 * Route-level: the real server and the real templates, only the backend API
 * mocked.
 */
import { vi } from 'vitest'
import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { config } from '#/config/config.js'

vi.mock(
  '#/server/common/helpers/backend-api/backend-api.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    getWorkItem: vi.fn(),
    getAccreditationSummary: vi.fn()
  })
)

const { getWorkItem, getAccreditationSummary } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '76900002-0000-4000-8000-000000000001'
const RE_ACCREDITATION_ID = '76900002-0000-4000-8000-000000000002'
const URL = `/work-items/${ID}/accreditation-summary`

const INTRO =
  'A summary of the accreditation as it stands today. The changes in this request are not included until the request is granted.'
const UNAVAILABLE = 'Accreditation summary is not available at the moment.'

function anAddOrsItem({ stateId = 'submitted' } = {}) {
  return {
    id: ID,
    typeId: 'add-overseas-site',
    stateId,
    templateVersion: 'v2',
    submittedAt: '2027-02-11T10:00:00Z',
    lastModifiedAt: '2027-02-11T10:00:00Z',
    assignedToId: 'officer-1',
    assignedToName: 'Pat Caseworker',
    payload: {
      applicationReference: 'IYC-ORS-2026-00001',
      organisationName: 'GreenLoop Recovery',
      operatorOrgNumber: 123001,
      accreditationReference: 'ACC-REP-PL-0007',
      site: { orsId: '007', siteName: 'Denmark PR' }
    },
    availableActions: [
      { actionId: 'duly-make', displayName: 'Duly make' },
      { actionId: 'query', displayName: 'Query' }
    ]
  }
}

function aReAccreditationItem() {
  return {
    id: RE_ACCREDITATION_ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    templateVersion: 'v1',
    payload: { applicationReference: 'RA-000000001' },
    availableActions: []
  }
}

function anAccreditation(overrides = {}) {
  return {
    organisationName: 'Acme Recycling Ltd',
    organisationNumber: 500500,
    accreditationNumber: 'A26ER5003240164GR',
    registrationNumber: 'R26ER5003240164GR',
    accreditationYear: 2026,
    wasteProcessingType: 'exporter',
    material: 'glass',
    glassRecyclingProcess: 'glass_re_melt',
    siteAddress: '1 High Street, Leeds, LS1 1AA',
    companyRegisteredAddress: '2 Registered Road, York, YO1 1AA',
    prns: {
      plannedTonnageBand: 'UpTo5000',
      authorisers: [
        { fullName: 'Ada Authoriser', email: 'ada@example.com' },
        { fullName: 'Bob Signer', email: 'bob@example.com' }
      ]
    },
    businessPlan: {
      newInfrastructurePercent: 60,
      newInfrastructureDetail: 'A new sorting line',
      priceSupportPercent: 40,
      priceSupportDetail: null
    },
    overseasSites: [
      aSite(),
      aSite({
        siteId: 8,
        orsId: '002',
        siteName: 'Excel Recycling BV',
        addressLine1: '3 Havenweg',
        addressLine2: null,
        townOrCity: 'Rotterdam',
        country: 'Netherlands'
      })
    ],
    ...overrides
  }
}

function aSite(overrides = {}) {
  return {
    siteId: 7,
    orsId: '001',
    siteName: 'Speira GmbH',
    siteAddress: null,
    addressLine1: '1 Test Strasse',
    addressLine2: 'Block B',
    townOrCity: 'Bremen',
    country: 'Germany',
    coordinates: '51.847,7.123',
    contactName: 'Hans Contact',
    contactEmail: 'hans@example.de',
    contactPhone: '+49 123',
    operationCodes: ['R4', 'R5'],
    code1: 'B1010',
    code2: 'B1020',
    code3: null,
    repatriatedLoads: 'As per article 18',
    conditionsOfExport: true,
    isEu: true,
    isOecd: false,
    ...overrides
  }
}

function aSummary({ accreditation = anAccreditation(), startDate } = {}) {
  return {
    ok: true,
    accreditation,
    accreditationStartDate: startDate ?? '2026-01-01'
  }
}

const squash = (text) => text.replace(/\s+/g, ' ').trim()

function rows($) {
  return $('[data-testid="accreditation-summary-details"] > div')
    .map((_, row) => ({
      key: $(row)
        .attr('data-testid')
        .replace(/^acc-summary-row-/, ''),
      label: squash($(row).children('dt').text()),
      value: squash($(row).children('dd').text())
    }))
    .get()
}

describe('RA-769: Accreditation summary tab', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItem.mockReset()
    getAccreditationSummary.mockReset()
    getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
    getAccreditationSummary.mockResolvedValue(aSummary())
  })

  async function get(url = URL) {
    const { statusCode, result } = await server.inject({ method: 'GET', url })
    return { statusCode, $: cheerio.load(result), result }
  }

  describe('an accreditation that can be read', () => {
    test('reads the summary live for the work item, as the signed-in caseworker', async () => {
      await get()

      expect(getAccreditationSummary).toHaveBeenCalledTimes(1)
      expect(getAccreditationSummary).toHaveBeenCalledWith(
        expect.objectContaining({ workItemId: ID })
      )
    })

    test('shows the heading, then the intro, then the rows, under the case header with the tab active', async () => {
      const { statusCode, $ } = await get()

      expect(statusCode).toBe(statusCodes.ok)
      expect(squash($('[data-testid="case-header-title"]').text())).toBe(
        'Denmark PR (007)'
      )
      expect(
        $(
          '[data-testid="case-tabs"] [data-testid="tab-accreditation-summary"]'
        ).attr('href')
      ).toBeUndefined()
      const panel = $('[data-testid="accreditation-summary-tab"]')
      expect(panel).toHaveLength(1)
      expect(squash(panel.find('h2').text())).toBe('Accreditation Summary')
      expect(
        squash($('[data-testid="accreditation-summary-intro"]').text())
      ).toBe(INTRO)
      expect(
        $('[data-testid="accreditation-summary-unavailable"]')
      ).toHaveLength(0)
    })

    test('lists the rows in order with the labels and formats of the spec', async () => {
      const { $ } = await get()

      expect(rows($)).toEqual([
        {
          key: 'organisation',
          label: 'Organisation',
          value: 'Acme Recycling Ltd (500500)'
        },
        {
          key: 'accreditation-number',
          label: 'Accreditation number',
          value: 'A26ER5003240164GR'
        },
        { key: 'status', label: 'Status', value: 'Granted' },
        {
          key: 'accreditation-year',
          label: 'Accreditation year',
          value: '2026'
        },
        {
          key: 'accreditation-start-date',
          label: 'Accreditation start date',
          value: '1 January 2026'
        },
        {
          key: 'registration-number',
          label: 'Registration number',
          value: 'R26ER5003240164GR'
        },
        {
          key: 'location',
          label: 'Location',
          value: '2 Registered Road, York, YO1 1AA'
        },
        { key: 'type', label: 'Type', value: 'Exporter accreditation' },
        { key: 'material', label: 'Material', value: 'Glass - Remelt' },
        {
          key: 'prn-tonnage',
          label: 'PRN tonnage',
          value: 'Up to 5,000 tonnes'
        },
        {
          key: 'prn-authorisers',
          label: 'PRN authorisers',
          value: 'Ada Authoriser (ada@example.com) Bob Signer (bob@example.com)'
        },
        {
          key: 'authority-to-issue',
          label: 'Authority to issue',
          value: 'Ada Authoriser Bob Signer'
        },
        {
          key: 'business-plan',
          label: 'Business plan',
          value:
            'New infrastructure — 60% of PRN incomeA new sorting line Price support — 40% of PRN income'
        },
        {
          key: 'ors',
          label: 'Overseas Reprocessing Site (ORS)',
          value: expect.stringMatching(/^001 Speira GmbH /)
        }
      ])
    })

    describe('overseas reprocessing sites', () => {
      const sitesOf = ($) => $('[data-testid="overseas-site"]')

      afterEach(() => {
        config.set('featureFlags.multipleInterimSitesEnabled', false)
      })

      test('lists each site as a section, every one collapsed on load', async () => {
        const { $ } = await get()

        const sites = sitesOf($)
        expect(sites).toHaveLength(2)
        sites.each((_, el) => {
          expect(el.tagName).toBe('details')
          expect($(el).attr('open')).toBeUndefined()
        })
      })

      test('each summary shows the number, name and address, even when the names are unique', async () => {
        const { $ } = await get()

        const text = (el, testId) =>
          squash($(el).find(`summary [data-testid="${testId}"]`).text())
        const summaries = sitesOf($)
          .map((_, el) => ({
            number: text(el, 'overseas-site-number'),
            name: text(el, 'overseas-site-name'),
            address: text(el, 'overseas-site-summary-address')
          }))
          .get()
        expect(summaries).toEqual([
          {
            number: '001',
            name: 'Speira GmbH',
            address: '1 Test Strasse, Germany'
          },
          {
            number: '002',
            name: 'Excel Recycling BV',
            address: '3 Havenweg, Netherlands'
          }
        ])
      })

      test('an expanded site shows its full address and details, in the design order', async () => {
        const { $ } = await get()

        const first = sitesOf($).first()
        const detail = (key) =>
          squash(first.find(`[data-testid="overseas-site-${key}"]`).text())
        expect(detail('address')).toBe(
          '1 Test Strasse, Block B, Bremen, Germany'
        )
        expect(detail('ors-id')).toBe('001')
        expect(detail('coordinates')).toBe('51.847,7.123')
        expect(detail('contact-name')).toBe('Hans Contact')
        expect(detail('contact-email')).toBe('hans@example.de')
        expect(detail('contact-phone')).toBe('+49 123')
        expect(detail('operation-code')).toBe('R4 R5')
        expect(detail('waste-codes')).toBe('B1010, B1020')
        expect(detail('repatriated-loads')).toBe('As per article 18')
        expect(detail('conditions-of-export')).toBe('Yes')
        expect(detail('eu-country')).toBe('Yes')
        expect(detail('oecd-country')).toBe('No')
        const labels = first
          .find('.govuk-details__text dt')
          .map((_, el) => squash($(el).text()))
          .get()
        expect(labels).toEqual([
          'ORS ID',
          'Coordinates',
          'Contact name',
          'Contact email',
          'Contact phone number',
          'Operation code',
          'Basel/OECD codes',
          'Repatriated loads',
          'Conditions of export',
          'EU country',
          'OECD country'
        ])
      })

      test('never shows "Registered, now seeking accreditation" or a NEW marker, even if a site were flagged', async () => {
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              overseasSites: [
                aSite({ isNewSite: true, registeredNowAccredited: true })
              ]
            })
          })
        )

        const { $, result } = await get()

        expect(result).not.toContain('Registered, now seeking accreditation')
        expect(result).not.toContain('NEW:')
        expect($('.app-new-flag')).toHaveLength(0)
      })

      test('shows the sites in the order answered', async () => {
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              overseasSites: [
                aSite({ orsId: '001', siteName: 'First' }),
                aSite({ siteId: 2, orsId: '002', siteName: 'Second' }),
                aSite({ siteId: 3, orsId: '010', siteName: 'Third' })
              ]
            })
          })
        )

        const { $ } = await get()

        expect(
          $('[data-testid="overseas-site-name"]')
            .map((_, el) => squash($(el).text()))
            .get()
        ).toEqual(['First', 'Second', 'Third'])
      })

      test('a site without an ORS ID shows no number rather than an empty one', async () => {
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              overseasSites: [aSite({ orsId: null })]
            })
          })
        )

        const { $ } = await get()

        expect($('[data-testid="overseas-site-number"]')).toHaveLength(0)
        expect(squash($('[data-testid="overseas-site-name"]').text())).toBe(
          'Speira GmbH'
        )
      })

      test.each([
        ['no sites', []],
        ['no site list at all', undefined]
      ])(
        'an exporter with %s shows the empty value in the row',
        async (_, overseasSites) => {
          getAccreditationSummary.mockResolvedValue(
            aSummary({ accreditation: anAccreditation({ overseasSites }) })
          )

          const { $ } = await get()

          expect(sitesOf($)).toHaveLength(0)
          expect(rows($).find((r) => r.key === 'ors').value).toBe('—')
        }
      )

      test('a reprocessor accreditation has no ORS row, even if sites came back', async () => {
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              wasteProcessingType: 'reprocessor',
              material: 'plastic',
              glassRecyclingProcess: null
            })
          })
        )

        const { $ } = await get()

        expect(rows($).map((r) => r.key)).not.toContain('ors')
        expect(sitesOf($)).toHaveLength(0)
      })

      test('hands the interim sites flag to the rendering, in either state', async () => {
        const interimSites = [
          {
            siteName: 'Depot A',
            siteNumber: 'SN-1',
            addressLine1: '1 Road',
            country: 'Spain'
          },
          {
            siteName: 'Depot B',
            siteNumber: 'SN-2',
            addressLine1: '2 Road',
            country: 'Spain'
          }
        ]
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              overseasSites: [aSite({ interimSites })]
            })
          })
        )

        const off = await get()
        expect(off.$('[data-testid="interim-sites"]')).toHaveLength(0)
        expect(off.$('[data-testid="interim-site"]')).toHaveLength(1)

        config.set('featureFlags.multipleInterimSitesEnabled', true)
        const on = await get()
        expect(on.$('[data-testid="interim-sites-label"]')).toHaveLength(1)
        expect(on.$('details[data-testid="interim-site"]')).toHaveLength(2)
      })
    })

    describe('PRN details and business plan', () => {
      const lines = ($, key) =>
        $(
          `[data-testid="acc-summary-value-${key}"] [data-testid="acc-summary-line"]`
        )
          .map((_, el) => squash($(el).text()))
          .get()

      test('shows each PRN authoriser as Name (email), and Authority to issue as names only', async () => {
        const { $ } = await get()

        expect(lines($, 'prn-authorisers')).toEqual([
          'Ada Authoriser (ada@example.com)',
          'Bob Signer (bob@example.com)'
        ])
        expect(lines($, 'authority-to-issue')).toEqual([
          'Ada Authoriser',
          'Bob Signer'
        ])
        expect(
          $('[data-testid="acc-summary-value-authority-to-issue"]').text()
        ).not.toContain('@')
      })

      test('shows an authoriser without a name by their email alone', async () => {
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              prns: {
                plannedTonnageBand: 'Over10000',
                authorisers: [{ fullName: '', email: 'solo@example.com' }]
              }
            })
          })
        )

        const { $ } = await get()

        expect(lines($, 'prn-authorisers')).toEqual(['solo@example.com'])
        expect(lines($, 'authority-to-issue')).toEqual(['solo@example.com'])
      })

      test('shows the tonnage band label', async () => {
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              prns: { plannedTonnageBand: 'Over10000', authorisers: [] }
            })
          })
        )

        const { $ } = await get()

        expect(
          squash($('[data-testid="acc-summary-value-prn-tonnage"]').text())
        ).toBe('More than 10,000 tonnes')
      })

      test('shows each business plan category with its share of PRN income, in the existing rendering', async () => {
        const { $ } = await get()

        const pairs = $(
          '[data-testid="acc-summary-value-business-plan"] [data-testid="acc-summary-pair"]'
        )
          .map((_, el) => squash($(el).text()))
          .get()
        expect(pairs).toEqual([
          'New infrastructure — 60% of PRN incomeA new sorting line',
          'Price support — 40% of PRN income'
        ])
      })

      test('never shows a NEW marker, even for an authoriser the backend flagged as new', async () => {
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              prns: {
                plannedTonnageBand: 'UpTo500',
                authorisers: [
                  { fullName: 'Ada', email: 'ada@example.com', isNew: true }
                ]
              }
            })
          })
        )

        const { $, result } = await get()

        expect(result).not.toContain('NEW:')
        expect($('.app-new-flag')).toHaveLength(0)
      })

      test('an accreditation with no authorisers and no business plan entries shows the empty value', async () => {
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              prns: { plannedTonnageBand: null, authorisers: [] },
              businessPlan: {}
            })
          })
        )

        const { $ } = await get()

        const byKey = Object.fromEntries(rows($).map((r) => [r.key, r.value]))
        expect(byKey['prn-tonnage']).toBe('—')
        expect(byKey['prn-authorisers']).toBe('—')
        expect(byKey['authority-to-issue']).toBe('—')
        expect(byKey['business-plan']).toBe('—')
        expect($('body').text()).not.toContain('undefined')
      })

      test('an accreditation without a prns section or business plan shows the empty value', async () => {
        getAccreditationSummary.mockResolvedValue(
          aSummary({
            accreditation: anAccreditation({
              prns: undefined,
              businessPlan: undefined
            })
          })
        )

        const { statusCode, $ } = await get()

        expect(statusCode).toBe(statusCodes.ok)
        const byKey = Object.fromEntries(rows($).map((r) => [r.key, r.value]))
        expect(byKey['prn-tonnage']).toBe('—')
        expect(byKey['prn-authorisers']).toBe('—')
        expect(byKey['authority-to-issue']).toBe('—')
        expect(byKey['business-plan']).toBe('—')
      })
    })

    test('shows Granted as a green tag, as the state badge does', async () => {
      const { $ } = await get()

      const tag = $('[data-testid="acc-summary-value-status"] .govuk-tag')
      expect(squash(tag.text())).toBe('Granted')
      expect(tag.hasClass('govuk-tag--green')).toBe(true)
    })

    test('formats the stored start date, not the accreditation year', async () => {
      getAccreditationSummary.mockResolvedValue(
        aSummary({ startDate: '2026-06-15' })
      )

      const { $ } = await get()

      expect(
        squash(
          $('[data-testid="acc-summary-value-accreditation-start-date"]').text()
        )
      ).toBe('15 June 2026')
    })

    test('a reprocessor shows its own site address as Location, and its type', async () => {
      getAccreditationSummary.mockResolvedValue(
        aSummary({
          accreditation: anAccreditation({
            wasteProcessingType: 'reprocessor',
            material: 'plastic',
            glassRecyclingProcess: null
          })
        })
      )

      const { $ } = await get()

      const byKey = Object.fromEntries(rows($).map((r) => [r.key, r.value]))
      expect(byKey.location).toBe('1 High Street, Leeds, LS1 1AA')
      expect(byKey.type).toBe('Reprocessor accreditation')
      expect(byKey.material).toBe('Plastic')
    })

    test('an exporter without a registered address has no Location value', async () => {
      getAccreditationSummary.mockResolvedValue(
        aSummary({
          accreditation: anAccreditation({ companyRegisteredAddress: null })
        })
      )

      const { $ } = await get()

      expect(rows($).find((r) => r.key === 'location').value).toBe('—')
    })

    test('a value the accreditation lacks reads as the empty value, never as undefined', async () => {
      getAccreditationSummary.mockResolvedValue(
        aSummary({
          accreditation: anAccreditation({
            organisationName: null,
            organisationNumber: null,
            accreditationNumber: null,
            registrationNumber: null
          })
        })
      )

      const { $ } = await get()

      const byKey = Object.fromEntries(rows($).map((r) => [r.key, r.value]))
      expect(byKey.organisation).toBe('—')
      expect(byKey['accreditation-number']).toBe('—')
      expect(byKey['registration-number']).toBe('—')
      expect($('body').text()).not.toContain('undefined')
    })

    test('an organisation without a number shows the name alone', async () => {
      getAccreditationSummary.mockResolvedValue(
        aSummary({
          accreditation: anAccreditation({ organisationNumber: null })
        })
      )

      const { $ } = await get()

      expect(rows($)[0].value).toBe('Acme Recycling Ltd')
    })

    test.each([
      'submitted',
      'duly-made',
      'assessment-started',
      'awaiting-decision',
      'approved-pending-contact',
      'approved',
      'rejected',
      'withdrawn'
    ])('shows the intro when the case is %s', async (stateId) => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anAddOrsItem({ stateId })
      })

      const { $ } = await get()

      expect(
        squash($('[data-testid="accreditation-summary-intro"]').text())
      ).toBe(INTRO)
    })

    test('has no assignment panel and no case actions', async () => {
      const { $ } = await get()

      expect($('[data-testid="case-assignment-panel"]')).toHaveLength(0)
      expect($('[data-testid="actions-card"]')).toHaveLength(0)
      const text = squash($('main').text())
      expect(text).not.toContain('Duly make')
      expect(text).not.toContain('Assign')
      expect(text).not.toContain('Query')
    })

    test('has no NEW marker and renders nothing from S3', async () => {
      const { $, result } = await get()

      expect($('.app-new-flag')).toHaveLength(0)
      expect(result).not.toContain('NEW:')
    })
  })

  describe('an accreditation that is not available', () => {
    test.each([
      ['not found, or not Approved', { ok: false, status: 404 }],
      ['a transient failure', { ok: false, status: 503, error: 'down' }],
      ['a transport failure', { ok: false, error: 'ECONNREFUSED' }],
      ['an unusable response', { ok: true }]
    ])(
      'says so under the heading in place of the intro and rows when it is %s',
      async (_, outcome) => {
        getAccreditationSummary.mockResolvedValue(outcome)

        const { statusCode, $ } = await get()

        expect(statusCode).toBe(statusCodes.ok)
        const panel = $('[data-testid="accreditation-summary-tab"]')
        expect(squash(panel.find('h2').text())).toBe('Accreditation Summary')
        expect(
          squash($('[data-testid="accreditation-summary-unavailable"]').text())
        ).toBe(UNAVAILABLE)
        expect($('[data-testid="accreditation-summary-intro"]')).toHaveLength(0)
        expect($('[data-testid="accreditation-summary-details"]')).toHaveLength(
          0
        )
      }
    )

    test('keeps the case header and the tabs', async () => {
      getAccreditationSummary.mockResolvedValue({ ok: false, status: 404 })

      const { $ } = await get()

      expect(squash($('[data-testid="case-header-title"]').text())).toBe(
        'Denmark PR (007)'
      )
      expect(
        $('[data-testid="case-tabs"] [data-testid^="tab-"]')
          .map((_, el) => $(el).attr('data-testid'))
          .get()
      ).toEqual([
        'tab-application-summary',
        'tab-accreditation-summary',
        'tab-related-applications',
        'tab-application-history'
      ])
    })
  })

  describe('the case itself', () => {
    test('is not found for an unknown work item, without reading the summary', async () => {
      getWorkItem.mockResolvedValue({ ok: false, status: 404 })

      const { statusCode } = await get()

      expect(statusCode).toBe(statusCodes.notFound)
      expect(getAccreditationSummary).not.toHaveBeenCalled()
    })

    test('is not found for a re-accreditation, which has no such tab', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aReAccreditationItem()
      })

      const { statusCode } = await get(
        `/work-items/${RE_ACCREDITATION_ID}/accreditation-summary`
      )

      expect(statusCode).toBe(statusCodes.notFound)
      expect(getAccreditationSummary).not.toHaveBeenCalled()
    })

    test('shows the work item unavailable page when the work item cannot be read', async () => {
      getWorkItem.mockResolvedValue({ ok: false, status: 500, error: 'boom' })

      const { statusCode, result } = await get()

      expect(statusCode).toBe(502)
      expect(result).toContain('Work item unavailable')
    })
  })
})
