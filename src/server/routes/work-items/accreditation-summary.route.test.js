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
      label: squash($(row).find('dt').text()),
      value: squash($(row).find('dd').text())
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
        { key: 'material', label: 'Material', value: 'Glass - Remelt' }
      ])
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
