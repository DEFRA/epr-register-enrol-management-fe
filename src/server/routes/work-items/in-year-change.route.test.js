/**
 * RA-739. An add-ORS (`add-overseas-site`) work item is an in-year change:
 * the Applications list renders it with the in-year change card variant, and
 * its detail link opens a page with the Figma add-ORS header and its own tabs.
 *
 * Route-level: the real server and the real module declarations and
 * templates, only the backend API mocked.
 */
import { vi } from 'vitest'
import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getAccreditationSummary: vi.fn(),
  getWorkItems: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  updateRecyclingOperations: vi.fn(),
  extendWorkItemSla: vi.fn(),
  dulyMakeWorkItem: vi.fn(),
  getDulyMakeDetails: vi.fn(),
  recordWorkItemDecision: vi.fn(),
  confirmWorkItemApplicantContact: vi.fn(),
  changeValidFromWorkItem: vi.fn()
}))

const {
  getWorkItem,
  getWorkItems,
  assignWorkItem,
  unassignWorkItem,
  applyWorkItemAction,
  updateRecyclingOperations,
  extendWorkItemSla,
  dulyMakeWorkItem,
  getDulyMakeDetails,
  addWorkItemNote,
  recordWorkItemDecision,
  confirmWorkItemApplicantContact,
  changeValidFromWorkItem
} = await import('#/server/common/helpers/backend-api/backend-api.js')

const ADD_ORS_ID = '73900003-0000-4000-8000-000000000001'
const RE_ACCREDITATION_ID = '73900003-0000-4000-8000-000000000002'

function anAddOrsItem({
  id = ADD_ORS_ID,
  submissionSize = 3,
  assignedToName = null,
  applicationReference = 'IYC-ORS-2026-00001',
  slaDueDate = null,
  slaState = null
} = {}) {
  return {
    id,
    typeId: 'add-overseas-site',
    stateId: 'submitted',
    templateVersion: 'v2',
    submittedAt: '2027-02-11T10:00:00Z',
    lastModifiedAt: '2027-02-11T10:00:00Z',
    assignedToId: assignedToName ? 'officer-1' : null,
    assignedToName,
    slaDueDate,
    slaState,
    payload: {
      operatorRequestId: 'request-1',
      organisationName: 'GreenLoop Recovery',
      operatorOrgNumber: 123001,
      material: 'Plastic',
      accreditationYear: 2026,
      applicationReference,
      submissionReference: 'SUB-2026-0001',
      submissionSize,
      accreditationReference: 'ACC-REP-PL-0007',
      paymentReference: 'PR/PK/REP/123001',
      chargePence: 98400,
      submittedBy: {
        fullName: 'Sam Operator',
        jobTitle: 'Director',
        email: 'sam@greenloop.example'
      },
      site: aSite()
    },
    availableActions: []
  }
}

/** A site as the operator backend sends it (re-accreditation's site shape). */
function aSite() {
  return {
    siteId: 'site-1',
    orsId: '007',
    siteName: 'Denmark PR',
    siteAddress: 'Ejbyvvej 12, Copenhagen, Denmark',
    addressLine1: 'Ejbyvvej 12',
    addressLine2: 'Industrial Park',
    townOrCity: 'Copenhagen',
    country: 'Denmark',
    coordinates: '55.6761, 12.5683',
    contactName: 'John Smith',
    contactEmail: 'john.smith@denmarkpr.com',
    contactPhone: '+23 2489 2862',
    operationCodes: ['R5'],
    code1: 'B1030',
    code2: '',
    code3: 'B3011',
    repatriatedLoads: 'Returned to the UK exporter.',
    conditionsOfExport: true,
    isEu: true,
    isOecd: true,
    interimSites: [
      {
        siteId: 101,
        siteNumber: 'SN-0101',
        siteName: 'Bharat Recycling',
        addressLine1: 'Havnegade 1',
        townOrCity: 'Aarhus',
        country: 'Denmark',
        contactName: 'Asha Patel',
        contactEmail: 'asha@bharat.example',
        contactPhone: '0123456789',
        operationCodes: ['R13']
      },
      {
        siteId: 102,
        siteNumber: 'SN-0102',
        siteName: 'Withdrawn Hub',
        addressLine1: '2 Quay Street',
        country: 'Belgium',
        removedAt: '2027-01-05T10:00:00Z'
      }
    ],
    besEvidence: {
      files: [
        {
          fileId: 'bes-clean',
          filename: 'bes-evidence.pdf',
          contentType: 'application/pdf',
          uploadedAt: '2027-01-15T10:00:00Z',
          scanStatus: 'Clean',
          besEvidenceValidFromDate: '2027-01-01',
          besEvidenceExpiryDate: '2028-12-31',
          s3Key: 'bes-evidence/bes-clean',
          s3Bucket: 'bes-evidence'
        },
        {
          fileId: 'bes-pending',
          filename: 'bes-pending.pdf',
          contentType: 'application/pdf',
          uploadedAt: '2027-01-16T10:00:00Z',
          scanStatus: 'Pending',
          besEvidenceValidFromDate: '2027-02-01',
          besEvidenceExpiryDate: '2029-01-31',
          s3Key: 'bes-evidence/bes-pending',
          s3Bucket: 'bes-evidence'
        }
      ]
    },
    suppliedFields: ['country'],
    chargePence: 32800
  }
}

function aReAccreditationItem() {
  return {
    id: RE_ACCREDITATION_ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    templateVersion: 'v18',
    submittedAt: '2026-04-27T10:00:00Z',
    payload: {
      applicationReference: 'RA-000000001',
      organisationName: 'Acme Recycling',
      operatorOrgNumber: 424242,
      registrationNumber: 'EPR-100999',
      material: 'plastic'
    }
  }
}

function listOf(...items) {
  return {
    ok: true,
    items,
    totalCount: items.length,
    page: 1,
    pageSize: 20
  }
}

function squash(text) {
  return text.replace(/\s+/g, ' ').trim()
}

const EM_DASH = '—'

/** The case tabs as rendered; the active tab has no link. */
function tabs($) {
  return $('[data-testid="case-tabs"] [data-testid^="tab-"]')
    .map((_, el) => ({
      key: $(el).attr('data-testid').replace(/^tab-/, ''),
      text: squash($(el).text()),
      href: $(el).attr('href') ?? null
    }))
    .get()
}

/**
 * RA-495. The add-ORS case tabs, in Figma's order with the ticket's names,
 * as `tabs($)` reads them with `active` the current tab (no link).
 */
function addOrsTabs(active) {
  const base = `/work-items/${ADD_ORS_ID}`
  return [
    ['application-summary', 'Application summary', base],
    [
      'accreditation-summary',
      'Accreditation summary',
      `${base}/accreditation-summary`
    ],
    [
      'related-applications',
      'Related applications',
      `${base}/related-applications`
    ],
    ['application-history', 'Application history', `${base}/audit-log`]
  ].map(([key, text, href]) => ({
    key,
    text,
    href: key === active ? null : href
  }))
}

let server

describe('RA-739 / RA-495: in-year change applications', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItem.mockReset()
    getWorkItems.mockReset()
    assignWorkItem.mockReset()
    unassignWorkItem.mockReset()
    applyWorkItemAction.mockReset()
    updateRecyclingOperations.mockReset()
    extendWorkItemSla.mockReset()
    dulyMakeWorkItem.mockReset()
    getDulyMakeDetails.mockReset()
    addWorkItemNote.mockReset()
    recordWorkItemDecision.mockReset()
    confirmWorkItemApplicantContact.mockReset()
  })

  async function listPage(...items) {
    getWorkItems.mockResolvedValue(listOf(...items))
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })
    expect(statusCode).toBe(statusCodes.ok)
    return cheerio.load(result)
  }

  describe('Applications list card', () => {
    test('shows every in-year change field on the card', async () => {
      const $ = await listPage(anAddOrsItem())
      const card = $(`[data-work-item-id="${ADD_ORS_ID}"]`)

      expect(card.attr('data-testid')).toBe('application-tile')
      expect(squash(card.find('[data-testid="submitted-on"]').text())).toBe(
        '11 February 2027'
      )
      expect(
        squash(card.find('[data-testid="submission-reference"]').text())
      ).toBe('SUB-2026-0001 (3 requests)')
      const link = card.find(`[data-testid="work-item-link-${ADD_ORS_ID}"]`)
      expect(link.attr('href')).toBe(`/work-items/${ADD_ORS_ID}`)
      expect(squash(link.text())).toBe('IYC-ORS-2026-00001')
      expect(squash(card.find('[data-testid="application-org"]').text())).toBe(
        'GreenLoop Recovery (123001): Plastic (Reprocessor)'
      )
      expect(squash(card.find('[data-testid="application-site"]').text())).toBe(
        'Denmark PR (007)'
      )
      expect(squash(card.find('[data-testid="request-type"]').text())).toBe(
        'Request type: New ORS accreditation'
      )
      expect(
        squash(card.find('[data-testid="application-assigned-to"]').text())
      ).toBe('Assigned to: Unassigned')
      expect(
        squash(
          card.find(`[data-testid="work-item-state-tag-${ADD_ORS_ID}"]`).text()
        )
      ).toBe('Not started')
      expect(card.text()).toContain('Submitted on:')
      expect(card.text()).not.toContain('Date submitted:')
    })

    test('lays out its lines as the re-accreditation card does', async () => {
      const $ = await listPage(anAddOrsItem())
      const card = $(`[data-work-item-id="${ADD_ORS_ID}"]`)

      // First the request type with the submission reference to its right, as
      // on a re-accreditation card; then the site line, then the organisation
      // line (as the registration number sits above the organisation on a
      // re-accreditation card); then the footer.
      const order = card
        .find(
          '[data-testid="application-request"], [data-testid="application-org"], [data-testid="application-site"], [data-testid="application-card-footer"]'
        )
        .map((_, el) => $(el).attr('data-testid'))
        .get()
      expect(order).toEqual([
        'application-request',
        'application-site',
        'application-org',
        'application-card-footer'
      ])
      const footer = card.find('[data-testid="application-card-footer"]')
      expect(squash(footer.text())).toBe(
        'Submitted on: 11 February 2027 Assigned to: Unassigned'
      )
      const request = card.find('[data-testid="application-request"]')
      expect(
        request
          .children()
          .map((_, el) => $(el).attr('data-testid'))
          .get()
      ).toEqual(['request-type', 'submission-reference'])
      expect(
        request
          .find('[data-testid="submission-reference"]')
          .hasClass('app-application-card__meta--divided')
      ).toBe(true)
      expect(
        card.find('.app-application-card__header [data-testid="submitted-on"]')
      ).toHaveLength(0)
      // The organisation line is small text, as on a re-accreditation card;
      // the site line is body size.
      expect(
        card.find('[data-testid="application-org"]').hasClass('govuk-body-s')
      ).toBe(true)
      expect(
        card.find('[data-testid="application-site"]').hasClass('govuk-body')
      ).toBe(true)
    })

    test('shows the site name alone when the site has no ORS id', async () => {
      const item = anAddOrsItem()
      item.payload.site = { siteName: 'Denmark PR' }
      const $ = await listPage(item)

      expect(squash($('[data-testid="application-site"]').text())).toBe(
        'Denmark PR'
      )
      expect($('[data-testid="ors-id"]')).toHaveLength(0)
    })

    test('shows no request count for a single-site submission', async () => {
      const $ = await listPage(anAddOrsItem({ submissionSize: 1 }))

      expect(squash($('[data-testid="submission-reference"]').text())).toBe(
        'SUB-2026-0001'
      )
    })

    test('shows the request count alone when there is no submission reference', async () => {
      const item = anAddOrsItem()
      delete item.payload.submissionReference
      const $ = await listPage(item)

      expect(squash($('[data-testid="submission-reference"]').text())).toBe(
        '(3 requests)'
      )
    })

    test('shows nothing after the request type, divider included, with no submission reference and one request', async () => {
      const item = anAddOrsItem({ submissionSize: 1 })
      delete item.payload.submissionReference
      const $ = await listPage(item)

      expect($('[data-testid="submission-reference"]')).toHaveLength(0)
      expect(squash($('[data-testid="application-request"]').text())).toBe(
        'Request type: New ORS accreditation'
      )
    })

    test('shows a re-accreditation card its submission reference when its payload has one', async () => {
      const item = aReAccreditationItem()
      item.payload.submissionReference = 'SUB-2026-0009'
      item.payload.submissionSize = 2
      const $ = await listPage(item)
      const card = $(`[data-work-item-id="${RE_ACCREDITATION_ID}"]`)

      expect(
        squash(card.find('[data-testid="application-request"]').text())
      ).toBe('Request type: Re-accreditation SUB-2026-0009 (2 requests)')
      expect(
        card
          .find('[data-testid="submission-reference"]')
          .hasClass('app-application-card__meta--divided')
      ).toBe(true)
    })

    test('names the assigned officer', async () => {
      const $ = await listPage(anAddOrsItem({ assignedToName: 'Jo Officer' }))

      expect(squash($('[data-testid="application-assigned-to"]').text())).toBe(
        'Assigned to: Jo Officer'
      )
    })

    test('has no registration number or due date line', async () => {
      const $ = await listPage(anAddOrsItem())
      const card = $(`[data-work-item-id="${ADD_ORS_ID}"]`)

      expect(card.find('[data-testid="registration-number"]')).toHaveLength(0)
      expect(card.find('[data-testid="due-on"]')).toHaveLength(0)
    })

    test('names an exporter as the applicant type on the organisation line', async () => {
      const item = anAddOrsItem()
      item.payload.wasteProcessingType = 'exporter'
      const $ = await listPage(item)

      expect(squash($('[data-testid="application-org"]').text())).toBe(
        'GreenLoop Recovery (123001): Plastic (Exporter)'
      )
    })

    test('puts Due on between Submitted on and Assigned to once the SLA clock runs', async () => {
      const $ = await listPage(
        anAddOrsItem({
          slaState: 'OnTrack',
          slaDueDate: '2027-03-11T00:00:00Z'
        })
      )
      const card = $(`[data-work-item-id="${ADD_ORS_ID}"]`)

      expect(
        squash(card.find('[data-testid="application-card-footer"]').text())
      ).toBe(
        'Submitted on: 11 February 2027 Due on: 11 March 2027 Assigned to: Unassigned'
      )
    })

    test('shows the request type at body size with a bold label, like the registration number', async () => {
      const $ = await listPage(anAddOrsItem(), aReAccreditationItem())

      for (const id of [ADD_ORS_ID, RE_ACCREDITATION_ID]) {
        const request = $(
          `[data-work-item-id="${id}"] [data-testid="application-request"]`
        )
        expect(request.hasClass('govuk-body')).toBe(true)
        expect(
          request
            .find(
              '[data-testid="request-type"] > .app-application-card__meta-label'
            )
            .text()
        ).toBe('Request type:')
      }
    })

    test('keeps the re-accreditation card beside it as before, under a request type line', async () => {
      const $ = await listPage(anAddOrsItem(), aReAccreditationItem())
      const card = $(`[data-work-item-id="${RE_ACCREDITATION_ID}"]`)

      expect(card.find('[data-testid="registration-number"]').text()).toBe(
        'EPR-100999'
      )
      expect(card.find('[data-testid="applicant-type"]').text()).toBe(
        'Reprocessor'
      )
      expect(card.find('[data-testid="submission-reference"]')).toHaveLength(0)
      expect(squash(card.find('[data-testid="request-type"]').text())).toBe(
        'Request type: Re-accreditation'
      )
      // The request type is the first line under the header, as on the
      // in-year change card.
      expect(
        card
          .children()
          .not('.app-application-card__header')
          .first()
          .attr('data-testid')
      ).toBe('application-request')
    })

    test('puts the registration number above the organisation on a re-accreditation card', async () => {
      const $ = await listPage(aReAccreditationItem())
      const card = $(`[data-work-item-id="${RE_ACCREDITATION_ID}"]`)

      expect(
        card
          .find(
            '[data-testid="application-request"], [data-testid="application-registration"], [data-testid="application-org"], [data-testid="application-card-footer"]'
          )
          .map((_, el) => $(el).attr('data-testid'))
          .get()
      ).toEqual([
        'application-request',
        'application-registration',
        'application-org',
        'application-card-footer'
      ])
    })
  })

  describe('detail page', () => {
    async function detailPage(workItem) {
      getWorkItem.mockResolvedValue({ ok: true, workItem })
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ADD_ORS_ID}`
      })
      expect(statusCode).toBe(statusCodes.ok)
      return cheerio.load(result)
    }

    test('titles the header with the site and ORS id, with no reference caption', async () => {
      const $ = await detailPage(anAddOrsItem())

      expect($('[data-testid="add-overseas-site-detail"]')).toHaveLength(1)
      expect($('[data-testid="case-header-caption"]')).toHaveLength(0)
      expect(squash($('[data-testid="case-header-title"]').text())).toBe(
        'Denmark PR (007)'
      )
      // The breadcrumb is unchanged: "Applications" › reference.
      expect(
        squash($('[data-testid="case-header-applications-link"]').text())
      ).toBe('Applications')
      expect($('[data-testid="case-header-accreditation-ref"]').text()).toBe(
        'IYC-ORS-2026-00001'
      )
      // No organisation name or Org ID, as in the design.
      expect($('[data-testid="case-header-org-name"]')).toHaveLength(0)
      expect($('[data-testid="case-header-org-id"]')).toHaveLength(0)
      expect($('[data-testid="case-header"]').text()).not.toContain(
        'GreenLoop Recovery'
      )
      expect($('[data-testid="case-header"]').text()).not.toContain('123001')
    })

    test('shows the ten meta items, in the order re-accreditation shares, with the site charge', async () => {
      const $ = await detailPage(anAddOrsItem())

      const meta = $(
        '[data-testid="case-header-meta"] .app-case-header__meta-item'
      )
        .map((_, el) => squash($(el).text()))
        .get()
      expect(meta).toEqual([
        'Application type: New ORS accreditation',
        'Status: Not started',
        'Assigned to: Unassigned',
        `Due date: ${EM_DASH}`,
        'Accreditation number: ACC-REP-PL-0007',
        'Material: Plastic',
        'Charge: £328.00',
        'Payment date: Not received',
        'Submitted by: Sam Operator',
        'Submitted on: 11 Feb 2027'
      ])
      expect(
        $(
          '[data-testid="case-header-status"] [data-testid="work-item-state-tag"]'
        )
      ).toHaveLength(1)
    })

    test('shows the due date and assignee once the case is under way', async () => {
      const $ = await detailPage(
        anAddOrsItem({
          assignedToName: 'Jo Officer',
          slaDueDate: '2027-03-11T10:00:00Z',
          slaState: 'OnTrack'
        })
      )

      expect(squash($('[data-testid="case-header-assigned-to"]').text())).toBe(
        'Jo Officer'
      )
      expect(squash($('[data-testid="case-header-due-on"]').text())).toBe(
        '11 Mar 2027'
      )
    })

    test('hides the due date when the SLA is cancelled', async () => {
      const $ = await detailPage(
        anAddOrsItem({
          slaDueDate: '2027-03-11T10:00:00Z',
          slaState: 'Cancelled'
        })
      )

      expect(squash($('[data-testid="case-header-due-on"]').text())).toBe(
        EM_DASH
      )
    })

    test('shows a dash for each missing value', async () => {
      const item = anAddOrsItem()
      delete item.payload.material
      delete item.payload.accreditationReference
      item.payload.site = { siteName: 'Denmark PR' }
      const $ = await detailPage(item)

      for (const key of ['material', 'accreditation-number', 'charge']) {
        expect(
          squash($(`[data-testid="case-header-${key}"]`).text()),
          key
        ).toBe(EM_DASH)
      }
    })

    test('shows the payment date once it is recorded', async () => {
      const item = anAddOrsItem()
      item.payload.paymentDate = '2027-02-20'
      const $ = await detailPage(item)

      expect(squash($('[data-testid="case-header-payment-date"]').text())).toBe(
        '20 Feb 2027'
      )
    })

    test('shows the four add-ORS tabs, with Application summary active', async () => {
      const $ = await detailPage(anAddOrsItem())

      expect(tabs($)).toEqual(addOrsTabs('application-summary'))
      expect($('[data-testid="re-accreditation-detail"]')).toHaveLength(0)
      expect($('[data-testid="work-item-actions"]')).toHaveLength(0)
    })

    test('keeps the re-accreditation header and tabs unchanged', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aReAccreditationItem()
      })
      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${RE_ACCREDITATION_ID}`
      })
      const $ = cheerio.load(result)

      expect($('[data-testid="case-header-caption"]')).toHaveLength(0)
      expect($('[data-testid="case-header-title"]')).toHaveLength(0)
      expect($('[data-testid="case-header-meta"]').attr('class')).toBe(
        'app-case-header__meta'
      )
      expect($('[data-testid="case-header-org-name"]').text()).toBe(
        'Acme Recycling'
      )
      expect($('[data-testid="case-header-org-id"]').text()).toBe('424242')
      expect(tabs($).map((tab) => tab.key)).toEqual([
        'application-summary',
        'application-history',
        'additional-information'
      ])
    })
  })

  describe('Application summary', () => {
    async function summaryPage(workItem) {
      getWorkItem.mockResolvedValue({ ok: true, workItem })
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ADD_ORS_ID}`
      })
      expect(statusCode).toBe(statusCodes.ok)
      return cheerio.load(result)
    }

    /** The site summary list's rows, in page order. */
    function summaryRows($) {
      return $('[data-testid="application-details"] > .govuk-summary-list__row')
        .map((_, el) => ({
          label: squash($(el).find('.govuk-summary-list__key').text()),
          value: squash($(el).find('.govuk-summary-list__value').text())
        }))
        .get()
    }

    function rowValue($, key) {
      return $(`[data-testid="app-detail-value-${key}"]`)
    }

    test('has no Valid from date until the determination records one', async () => {
      const $ = await summaryPage(anAddOrsItem())

      expect($('[data-testid="application-valid-from"]')).toHaveLength(0)
      expect(rowValue($, 'valid-from')).toHaveLength(0)
    })

    // A refusal records the submission date as its effective date, so the
    // date is shown only once the case is Approved or Granted.
    test.each([
      'submitted',
      'duly-made',
      'rejected-pending-contact',
      'rejected'
    ])(
      'shows no Valid from date in state %s, even with a date recorded',
      async (stateId) => {
        const item = { ...anAddOrsItem(), stateId }
        item.payload.effectiveDate = '2027-03-01'
        const $ = await summaryPage(item)

        expect($('[data-testid="application-valid-from"]')).toHaveLength(0)
        expect(rowValue($, 'valid-from')).toHaveLength(0)
      }
    )

    test.each(['approved-pending-contact', 'approved'])(
      'leads with the Valid from date, set apart from the site rows, once recorded, in state %s',
      async (stateId) => {
        const item = { ...anAddOrsItem(), stateId }
        item.payload.effectiveDate = '2027-03-01'
        const $ = await summaryPage(item)

        const validFrom = $('[data-testid="application-valid-from"]')
        expect(squash(validFrom.find('.govuk-summary-list__key').text())).toBe(
          'Valid from date'
        )
        expect(squash(rowValue($, 'valid-from').text())).toBe('01 Mar 2027')
        // Its own list, with a gap, ahead of the site's rows.
        expect(validFrom.hasClass('govuk-!-margin-bottom-6')).toBe(true)
        expect(
          validFrom.nextAll('[data-testid="application-details"]')
        ).toHaveLength(1)
        expect(summaryRows($)[0].label).toBe('Site name')
      }
    )

    test('shows every site row with its Figma label, in order', async () => {
      const $ = await summaryPage(anAddOrsItem())

      const rows = summaryRows($)
      expect(rows.map((row) => row.label)).toEqual([
        'Site name',
        'Location',
        'ORS ID',
        'Coordinates',
        'Contact name',
        'Contact email',
        'Contact phone number',
        'Operation code',
        'Basel/OECD codes',
        'Arrangements for rejected or returned loads',
        'Conditions of export',
        'Evidence of broadly equivalent standards'
      ])
      expect(rows.slice(0, 11).map((row) => row.value)).toEqual([
        'Denmark PR',
        // The fixture's operator supplied the country (RA-495).
        'NEW: Ejbyvvej 12, Industrial Park, Copenhagen, Denmark',
        '007',
        '55.6761, 12.5683',
        'John Smith',
        'john.smith@denmarkpr.com',
        '+23 2489 2862',
        'R5',
        // code2 is empty, so it is left out.
        'B1030, B3011',
        'Returned to the UK exporter.',
        'Yes'
      ])
    })

    test('heads the site rows Application details, as re-accreditation', async () => {
      const $ = await summaryPage(anAddOrsItem())

      expect(
        squash($('[data-testid="application-details-heading"]').text())
      ).toBe('Application details')
    })

    test('has no dividing lines between site or interim site rows, as re-accreditation', async () => {
      const $ = await summaryPage(anAddOrsItem())

      expect(
        $('[data-testid="application-details"]').hasClass(
          'app-summary-list--borderless'
        )
      ).toBe(true)
      const interimLists = $('[data-testid="interim-site"] .govuk-summary-list')
      expect(interimLists.length).toBeGreaterThan(0)
      interimLists.each((_, list) => {
        expect($(list).hasClass('app-summary-list--borderless')).toBe(true)
      })
    })

    test('answers No when the conditions of export are not met', async () => {
      const item = anAddOrsItem()
      item.payload.site.conditionsOfExport = false
      const $ = await summaryPage(item)

      expect(squash(rowValue($, 'conditions-of-export').text())).toBe('No')
    })

    test('shows a dash for each missing value, and no documents for missing BES evidence', async () => {
      const item = anAddOrsItem()
      item.payload.site = { siteName: 'Denmark PR' }
      const $ = await summaryPage(item)

      const rows = summaryRows($)
      expect(rows).toHaveLength(12)
      expect(rows[0].value).toBe('Denmark PR')
      for (const row of rows.slice(1, -1)) {
        expect(row.value, row.label).toBe(EM_DASH)
      }
      // As re-accreditation words an empty file row.
      expect(rows.at(-1).value).toBe('No documents uploaded.')
      expect(
        rowValue($, 'bes-evidence').find(
          '[data-testid="app-detail-documents-none"]'
        )
      ).toHaveLength(1)
      expect($('[data-testid="interim-sites"]')).toHaveLength(0)
    })

    test('links a Clean BES file to the download route, with its dates', async () => {
      const $ = await summaryPage(anAddOrsItem())
      const [clean] = rowValue($, 'bes-evidence').find('li').toArray()

      const link = $(clean).find('a[data-testid="app-detail-document"]')
      expect(squash(link.text())).toBe('bes-evidence.pdf')
      expect(link.attr('href')).toBe(
        `/work-items/${ADD_ORS_ID}/files/bes-clean/download`
      )
      expect($(clean).find('.govuk-tag')).toHaveLength(0)
      expect(
        squash(
          $(clean).find('[data-testid="app-detail-document-valid-from"]').text()
        )
      ).toBe('Valid from: 01 Jan 2027')
      expect(
        squash(
          $(clean)
            .find('[data-testid="app-detail-document-expiry-date"]')
            .text()
        )
      ).toBe('Expiry date: 31 Dec 2028')
    })

    test('shows a BES file that is not Clean by name and scan tag, with no link', async () => {
      const $ = await summaryPage(anAddOrsItem())
      const [, pending] = rowValue($, 'bes-evidence').find('li').toArray()

      expect($(pending).find('a')).toHaveLength(0)
      expect(
        squash($(pending).find('[data-testid="app-detail-document"]').text())
      ).toBe('bes-pending.pdf')
      expect(squash($(pending).find('.govuk-tag').text())).toBe('Pending')
      expect(
        squash(
          $(pending)
            .find('[data-testid="app-detail-document-valid-from"]')
            .text()
        )
      ).toBe('Valid from: 01 Feb 2027')
      expect(
        squash(
          $(pending)
            .find('[data-testid="app-detail-document-expiry-date"]')
            .text()
        )
      ).toBe('Expiry date: 31 Jan 2029')
    })

    test('lists the active interim sites with their fields', async () => {
      const $ = await summaryPage(anAddOrsItem())
      const section = $('[data-testid="interim-sites"]')

      // The withdrawn site is left out of the count and the list.
      expect(
        squash(section.find('[data-testid="interim-sites-heading"]').text())
      ).toBe('Interim sites (1)')
      const sites = section.find('[data-testid="interim-site"]')
      expect(sites).toHaveLength(1)
      expect(section.text()).not.toContain('Withdrawn Hub')

      const site = sites.first()
      expect(
        squash(site.find('[data-testid="interim-site-name"]').text())
      ).toBe('Bharat Recycling')
      // Always open, not a disclosure (user, 2026-11-20); the only interim
      // site has a unique name, so no short address.
      expect(site.is('details')).toBe(false)
      expect(site.find('details, .govuk-details__text')).toHaveLength(0)
      expect(
        site.find('[data-testid="interim-site-summary-address"]')
      ).toHaveLength(0)
      const fields = site
        .find('.govuk-summary-list__row')
        .map((_, el) => [
          [
            squash($(el).find('.govuk-summary-list__key').text()),
            squash($(el).find('.govuk-summary-list__value').text())
          ]
        ])
        .get()
      expect(fields).toEqual([
        ['Site number', 'SN-0101'],
        ['Location', 'Havnegade 1, Aarhus, Denmark'],
        ['Contact name', 'Asha Patel'],
        ['Contact email', 'asha@bharat.example'],
        ['Contact phone number', '0123456789'],
        ['Operation code', 'R13']
      ])
    })

    test('shows the short address only for interim sites that share a name', async () => {
      const item = anAddOrsItem()
      const [bharat] = item.payload.site.interimSites
      item.payload.site.interimSites = [
        bharat,
        { ...bharat, siteId: 102, addressLine1: 'Kajen 2', country: 'Sweden' },
        { ...bharat, siteId: 103, siteName: 'Oslo Hub', country: 'Norway' }
      ]
      const $ = await summaryPage(item)

      const addresses = $('[data-testid="interim-site"]')
        .map((_, el) =>
          squash(
            $(el).find('[data-testid="interim-site-summary-address"]').text()
          )
        )
        .get()
      expect(addresses).toEqual(['Havnegade 1, Denmark', 'Kajen 2, Sweden', ''])
    })

    test('has no Interim sites section when every interim site is withdrawn', async () => {
      const item = anAddOrsItem()
      item.payload.site.interimSites = item.payload.site.interimSites.filter(
        (site) => site.removedAt != null
      )
      const $ = await summaryPage(item)

      expect($('[data-testid="interim-sites"]')).toHaveLength(0)
      expect($('body').text()).not.toContain('Interim sites')
    })

    test('has the assignment panel, and no generic, Query or decision actions', async () => {
      const item = anAddOrsItem()
      // Even if the backend projects actions, none render as generic
      // buttons. Only the Duly make CTA (RA-495) is offered.
      item.availableActions = [
        { actionId: 'duly-make', displayName: 'Duly make' },
        { actionId: 'query', displayName: 'Query' },
        { actionId: 'sla-extend', displayName: 'Change the due date' }
      ]
      const $ = await summaryPage(item)

      const panel = $('[data-testid="case-assignment-panel"]')
      expect(panel).toHaveLength(1)
      expect(
        squash(panel.find('[data-testid="self-assign-submit"]').text())
      ).toBe('Assign to yourself and start')
      expect(squash(panel.find('[data-testid="reassign-link"]').text())).toBe(
        'Reassign the application'
      )
      expect(squash(panel.find('[data-testid="unassign-link"]').text())).toBe(
        'Unassign the application'
      )
      expect(
        squash(panel.find('[data-testid="action-sla-extend"]').text())
      ).toBe('Change determination deadline')

      expect($('[data-testid="duly-make-cta"]')).toHaveLength(1)
      expect($('[data-testid="log-decision-cta"]')).toHaveLength(0)
      expect($('[data-testid="work-item-actions"]')).toHaveLength(0)
      expect($('[data-testid="work-item-no-actions"]')).toHaveLength(0)
      expect($('[data-testid="action-duly-make"]')).toHaveLength(0)
      expect($('[data-testid="action-query"]')).toHaveLength(0)
    })

    test('self-assigning a Not started application assigns it without changing its status', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
      assignWorkItem.mockResolvedValue({
        ok: true,
        workItem: anAddOrsItem({ assignedToName: 'Test Standard User' })
      })

      const { statusCode, headers } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ADD_ORS_ID}/self-assign`,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(`/work-items/${ADD_ORS_ID}`)
      expect(assignWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ADD_ORS_ID,
          assigneeId: 'test-standard-id'
        })
      )
      expect(applyWorkItemAction).not.toHaveBeenCalled()
    })

    test('does not show EU or OECD rows', async () => {
      const $ = await summaryPage(anAddOrsItem())
      const summary = $('[data-testid="application-details"]').text()

      expect(summary).not.toContain('EU country')
      expect(summary).not.toContain('OECD country')
    })

    // RA-495 AC2. The fixture's operator supplied the country only.
    test('marks the values the operator supplied with the NEW: prefix', async () => {
      const $ = await summaryPage(anAddOrsItem())

      expect(squash(rowValue($, 'location').text())).toBe(
        'NEW: Ejbyvvej 12, Industrial Park, Copenhagen, Denmark'
      )
      expect(
        rowValue($, 'location').find(
          '.app-new-flag[data-testid="app-detail-supplied-location"]'
        )
      ).toHaveLength(1)
      expect(
        $('[data-testid="application-details"] .app-new-flag')
      ).toHaveLength(1)
    })

    test('marks every supplied field, and nothing when none was supplied', async () => {
      const item = anAddOrsItem()
      item.payload.site.suppliedFields = [
        'country',
        'coordinates',
        'operationCodes',
        'conditionsOfExport'
      ]
      let $ = await summaryPage(item)
      expect(
        $('[data-testid^="app-detail-supplied-"]')
          .map((_, el) => $(el).attr('data-testid'))
          .get()
      ).toEqual([
        'app-detail-supplied-location',
        'app-detail-supplied-coordinates',
        'app-detail-supplied-recycling-operation',
        'app-detail-supplied-conditions-of-export'
      ])
      expect(squash(rowValue($, 'recycling-operation').text())).toBe('NEW: R5')

      item.payload.site.suppliedFields = []
      $ = await summaryPage(item)
      expect($('.app-new-flag')).toHaveLength(0)
    })

    // 3bb.13: evidence the operator uploaded on the request is marked once,
    // on the first file, as a supplied value is on its first line.
    test('marks the BES evidence the operator uploaded on its first file', async () => {
      const item = anAddOrsItem()
      item.payload.site.suppliedFields = ['besEvidence']
      const $ = await summaryPage(item)
      const marks = rowValue($, 'bes-evidence').find(
        '.app-new-flag[data-testid="app-detail-supplied-bes-evidence"]'
      )
      expect(marks).toHaveLength(1)
      expect(
        squash(rowValue($, 'bes-evidence').find('li').first().text())
      ).toMatch(/^NEW: bes-evidence.pdf/)
      expect(
        $('[data-testid="application-details"] .app-new-flag')
      ).toHaveLength(1)
    })
  })

  // Stories 30 and 31: reassign, unassign and change the due date through
  // the routes re-accreditation uses. Recording each in Application history
  // is management-be's.
  describe('managing an add-ORS application', () => {
    const DETAIL_URL = `/work-items/${ADD_ORS_ID}`
    const FORM = { 'content-type': 'application/x-www-form-urlencoded' }

    async function followRedirect(posted) {
      expect(posted.statusCode).toBe(statusCodes.redirect)
      expect(posted.headers.location).toBe(DETAIL_URL)
      const cookie = []
        .concat(posted.headers['set-cookie'] ?? [])
        .map((header) => header.split(';')[0])
        .join('; ')
      const followed = await server.inject({
        method: 'GET',
        url: DETAIL_URL,
        headers: { cookie }
      })
      return cheerio.load(followed.result)
    }

    test('reassigning sends the chosen caseworker to the backend and returns to the application', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
      assignWorkItem.mockResolvedValue({
        ok: true,
        workItem: anAddOrsItem({ assignedToName: 'Stub Caseworker One' })
      })

      const { statusCode, headers } = await injectWithCrumb(server, {
        method: 'POST',
        url: `${DETAIL_URL}/assign`,
        payload: 'assigneeId=stub-caseworker-1',
        headers: FORM
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(DETAIL_URL)
      expect(assignWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ADD_ORS_ID,
          assigneeId: 'stub-caseworker-1',
          assigneeName: 'Stub Caseworker One',
          user: expect.objectContaining({ id: expect.any(String) })
        })
      )
      expect(applyWorkItemAction).not.toHaveBeenCalled()
    })

    test('unassigning clears the assignment and returns to the application', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anAddOrsItem({ assignedToName: 'Stub Caseworker One' })
      })
      unassignWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

      const { statusCode, headers } = await injectWithCrumb(server, {
        method: 'POST',
        url: `${DETAIL_URL}/unassign`
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(DETAIL_URL)
      expect(unassignWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ADD_ORS_ID,
          user: expect.objectContaining({ id: expect.any(String) })
        })
      )
    })

    test('a refused unassign shows the backend reason on the application', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
      unassignWorkItem.mockResolvedValue({
        ok: false,
        status: statusCodes.conflict,
        problem: {
          detail: 'This work item cannot be unassigned in its current state.'
        }
      })

      const { statusCode, result } = await injectWithCrumb(server, {
        method: 'POST',
        url: `${DETAIL_URL}/unassign`
      })

      expect(statusCode).toBe(statusCodes.conflict)
      expect(result).toContain('Could not unassign work item')
      expect(result).toContain(
        'This work item cannot be unassigned in its current state.'
      )
      expect(
        squash(cheerio.load(result)('[data-testid="case-header-title"]').text())
      ).toBe('Denmark PR (007)')
    })

    describe('changing the due date', () => {
      const EXTEND_URL = `${DETAIL_URL}/sla/extend`

      // Duly made on 20 February 2027, due 15 May 2027. The clock is pinned
      // so the deadline floor holds still.
      const inAssessment = () => ({
        ...anAddOrsItem({
          assignedToName: 'Test Standard User',
          slaDueDate: '2027-05-15T00:00:00Z',
          slaState: 'OnTrack'
        }),
        stateId: 'assessment-in-progress',
        slaStartedAt: '2027-02-20T00:00:00Z'
      })

      beforeEach(() => {
        vi.useFakeTimers({
          toFake: ['Date'],
          now: new Date('2027-03-01T09:00:00Z')
        })
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      test('sends the change to the backend and confirms it on the application', async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: inAssessment() })
        extendWorkItemSla.mockResolvedValue({
          ok: true,
          workItem: inAssessment()
        })

        const $ = await followRedirect(
          await injectWithCrumb(server, {
            method: 'POST',
            url: EXTEND_URL,
            payload:
              'reason=Waiting+on+evidence&new-deadline-day=19&new-deadline-month=6&new-deadline-year=2027',
            headers: FORM
          })
        )

        expect(extendWorkItemSla).toHaveBeenCalledWith(
          expect.objectContaining({
            workItemId: ADD_ORS_ID,
            reason: 'Waiting on evidence',
            additionalDuration: 'P35D'
          })
        )
        expect(assignWorkItem).not.toHaveBeenCalled()
        expect(applyWorkItemAction).not.toHaveBeenCalled()
        expect($('body').text()).toContain('Determination deadline changed')
        expect($('body').text()).toContain(
          'The determination deadline has been changed.'
        )
      })

      test('a change without a reason re-renders the form and sends nothing', async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: inAssessment() })

        const { statusCode, result } = await injectWithCrumb(server, {
          method: 'POST',
          url: EXTEND_URL,
          payload:
            'reason=&new-deadline-day=19&new-deadline-month=6&new-deadline-year=2027',
          headers: FORM
        })

        expect(statusCode).toBe(statusCodes.badRequest)
        expect(result).toContain('Reason is required')
        expect(extendWorkItemSla).not.toHaveBeenCalled()
      })
    })
  })

  // RA-495 AC4. A Not started add-ORS work item is duly made on its own,
  // through the shared Duly make page and the type-less management-be
  // endpoint.
  describe('duly making an add-ORS application', () => {
    const DETAIL_URL = `/work-items/${ADD_ORS_ID}`
    const DULY_MAKE_URL = `/work-items/add-overseas-site/${ADD_ORS_ID}/duly-make`
    const SIBLING_1 = '73900003-0000-4000-8000-000000000011'
    const SIBLING_2 = '73900003-0000-4000-8000-000000000012'

    /** The duly make details as management-be returns them. */
    function details(relatedWorkItems) {
      return {
        ok: true,
        details: {
          workItemId: ADD_ORS_ID,
          chargePence: 32800,
          relatedWorkItems
        }
      }
    }

    // Every work item in the submission, the current one included, by
    // application reference (user decision 2026-11-18).
    const currentWorkItem = {
      id: ADD_ORS_ID,
      typeId: 'add-overseas-site',
      stateId: 'submitted',
      applicationReference: 'IYC-ORS-2026-00001',
      siteName: 'Denmark PR',
      orsId: '007',
      chargePence: 32800
    }
    const relatedWorkItems = [
      currentWorkItem,
      {
        id: SIBLING_1,
        typeId: 'add-overseas-site',
        stateId: 'duly-made',
        applicationReference: 'IYC-ORS-2026-00002',
        siteName: 'Belgium PR',
        orsId: '010',
        chargePence: 32800
      },
      {
        id: SIBLING_2,
        typeId: 'add-overseas-site',
        stateId: 'submitted',
        applicationReference: 'IYC-ORS-2026-00003',
        siteName: 'Berlin Steel GmbH',
        orsId: '003',
        chargePence: null
      }
    ]

    async function dulyMakePage() {
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: DULY_MAKE_URL
      })
      expect(statusCode).toBe(statusCodes.ok)
      return cheerio.load(result)
    }

    function relatedRows($) {
      return $('[data-testid="duly-making-related-row"]')
        .map((_, row) =>
          ['reference', 'site', 'type', 'charge', 'status'].reduce(
            (cells, key) => ({
              ...cells,
              [key]: squash(
                $(row).find(`[data-testid="duly-making-related-${key}"]`).text()
              )
            }),
            {}
          )
        )
        .get()
    }

    test('the detail page offers Duly make on a Not started application', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

      const { result } = await server.inject({ method: 'GET', url: DETAIL_URL })
      const $ = cheerio.load(result)

      const cta = $('[data-testid="duly-make-cta"]')
      expect(cta).toHaveLength(1)
      expect(squash(cta.text())).toBe('Duly make')
      expect(cta.attr('href')).toBe(DULY_MAKE_URL)
      // Only duly making is offered on add-ORS for now.
      expect($('[data-testid="log-decision-cta"]')).toHaveLength(0)
      expect($('[data-testid="work-item-actions"]')).toHaveLength(0)
    })

    test('the detail page no longer offers Duly make once the application is duly made', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: { ...anAddOrsItem(), stateId: 'duly-made' }
      })

      const { result } = await server.inject({ method: 'GET', url: DETAIL_URL })
      const $ = cheerio.load(result)

      expect($('[data-testid="duly-make-cta"]')).toHaveLength(0)
    })

    test('the page shows the site charge, the payment reference and the payment date input', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
      getDulyMakeDetails.mockResolvedValue(details(relatedWorkItems))

      const $ = await dulyMakePage()

      expect(squash($('h1').text())).toContain('Duly make the application')
      expect(
        squash($('[data-testid="duly-making-charge-amount"]').text())
      ).toBe('£328.00')
      expect(
        squash($('[data-testid="duly-making-payment-reference"]').text())
      ).toBe('PR/PK/REP/123001')
      expect($('[data-testid="duly-making-payment-date"]')).toHaveLength(1)
      expect($('[data-testid="duly-making-form"]').attr('action')).toBe(
        DULY_MAKE_URL
      )
    })

    test('the page lists every change request from the same submission, this one included, with their status', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
      getDulyMakeDetails.mockResolvedValue(details(relatedWorkItems))

      const $ = await dulyMakePage()

      expect(getDulyMakeDetails).toHaveBeenCalledWith(
        expect.objectContaining({ workItemId: ADD_ORS_ID })
      )
      expect(
        squash($('[data-testid="duly-making-related-heading"]').text())
      ).toBe('Related change applications')
      expect(relatedRows($)).toEqual([
        {
          reference: 'IYC-ORS-2026-00001',
          site: 'Denmark PR (007)',
          type: 'New ORS accreditation',
          charge: '£328.00',
          status: 'Not started'
        },
        {
          reference: 'IYC-ORS-2026-00002',
          site: 'Belgium PR (010)',
          type: 'New ORS accreditation',
          charge: '£328.00',
          status: 'Duly made'
        },
        {
          reference: 'IYC-ORS-2026-00003',
          site: 'Berlin Steel GmbH (003)',
          type: 'New ORS accreditation',
          charge: EM_DASH,
          status: 'Not started'
        }
      ])
      // Read-only: nothing in the table can be acted on.
      expect(
        $(
          '[data-testid="duly-making-related"] a, [data-testid="duly-making-related"] input'
        )
      ).toHaveLength(0)
    })

    test('the page has no related change requests section for a single-site submission', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anAddOrsItem({ submissionSize: 1 })
      })
      // management-be lists the current work item even when it is alone.
      getDulyMakeDetails.mockResolvedValue(details([currentWorkItem]))

      const $ = await dulyMakePage()

      expect($('[data-testid="duly-making-related"]')).toHaveLength(0)
      expect($('[data-testid="duly-making-payment-date"]')).toHaveLength(1)
    })

    test('the page has no related change requests section when management-be lists none', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anAddOrsItem({ submissionSize: 1 })
      })
      getDulyMakeDetails.mockResolvedValue(details([]))

      const $ = await dulyMakePage()

      expect($('[data-testid="duly-making-related"]')).toHaveLength(0)
    })

    test('the page still lists a two-site submission when the current work item is left out', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
      getDulyMakeDetails.mockResolvedValue(details([relatedWorkItems[1]]))

      const $ = await dulyMakePage()

      expect(relatedRows($).map(({ reference }) => reference)).toEqual([
        'IYC-ORS-2026-00002'
      ])
    })

    test('the page says when the related change requests cannot be loaded, and still offers duly making', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
      getDulyMakeDetails.mockResolvedValue({ ok: false, status: 500 })

      const $ = await dulyMakePage()

      expect(
        squash($('[data-testid="duly-making-related-unavailable"]').text())
      ).toBe('Related change applications are not available at the moment.')
      expect($('[data-testid="duly-making-related-row"]')).toHaveLength(0)
      expect($('[data-testid="duly-making-payment-date"]')).toHaveLength(1)
    })

    test('the page is refused once the application is duly made', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: { ...anAddOrsItem(), stateId: 'duly-made' }
      })

      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: DULY_MAKE_URL
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(DETAIL_URL)
      expect(getDulyMakeDetails).not.toHaveBeenCalled()
    })

    test('submitting a payment date duly makes the application through the shared endpoint', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
      dulyMakeWorkItem.mockResolvedValue({
        ok: true,
        workItem: { ...anAddOrsItem(), stateId: 'duly-made' }
      })

      const { statusCode, headers } = await injectWithCrumb(server, {
        method: 'POST',
        url: DULY_MAKE_URL,
        payload:
          'payment-date-day=20&payment-date-month=2&payment-date-year=2026',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(DETAIL_URL)
      expect(dulyMakeWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ADD_ORS_ID,
          paymentDate: '2026-02-20'
        })
      )
      expect(applyWorkItemAction).not.toHaveBeenCalled()
    })

    test('an invalid payment date re-renders the page with the error and the related change requests', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
      getDulyMakeDetails.mockResolvedValue(details(relatedWorkItems))

      const { statusCode, result } = await injectWithCrumb(server, {
        method: 'POST',
        url: DULY_MAKE_URL,
        payload: 'payment-date-day=&payment-date-month=&payment-date-year=',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      const $ = cheerio.load(result)
      expect($('[data-testid="duly-making-error-summary"]')).toHaveLength(1)
      expect(relatedRows($)).toHaveLength(3)
      expect(dulyMakeWorkItem).not.toHaveBeenCalled()
    })
  })

  // RA-495 AC5 to AC8. The shared Make determination and Confirm applicant
  // contact pages, the pending-contact banner and the closed case's Outcome
  // panel, for an add-ORS work item.
  describe('determining an add-ORS application', () => {
    const DETAIL_URL = `/work-items/${ADD_ORS_ID}`
    const DECISION_URL = `/work-items/add-overseas-site/${ADD_ORS_ID}/decision`
    const CONFIRM_URL = `/work-items/add-overseas-site/${ADD_ORS_ID}/confirm-contact`

    function anItemIn(stateId) {
      return {
        ...anAddOrsItem({ assignedToName: 'Test Standard User' }),
        assignedToId: 'test-standard-id',
        stateId
      }
    }

    async function detailPage(stateId) {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anItemIn(stateId) })
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: DETAIL_URL
      })
      expect(statusCode).toBe(statusCodes.ok)
      return cheerio.load(result)
    }

    function postForm(url, payload) {
      return injectWithCrumb(server, {
        method: 'POST',
        url,
        payload,
        headers: { 'content-type': 'application/x-www-form-urlencoded' }
      })
    }

    test.each(['duly-made', 'assessment-started'])(
      'a %s application offers Make Determination and nothing else',
      async (stateId) => {
        const $ = await detailPage(stateId)

        const cta = $('[data-testid="log-decision-cta"]')
        expect(squash(cta.text())).toBe('Make Determination')
        expect(cta.attr('href')).toBe(DECISION_URL)
        expect($('[data-testid="duly-make-cta"]')).toHaveLength(0)
        expect($('[data-testid="confirm-applicant-contact-cta"]')).toHaveLength(
          0
        )
        // No generic, Query or Withdraw actions, and no empty-state line
        // under the CTA.
        expect($('[data-testid="work-item-actions"]')).toHaveLength(0)
        expect($('[data-testid="work-item-no-actions"]')).toHaveLength(0)
        expect($('[data-testid="action-query"]')).toHaveLength(0)
      }
    )

    // Not reachable for add-ORS today (it has no Query), but a state with no
    // lifecycle step to offer must not draw an empty actions card.
    test('an application with no lifecycle step to offer has no actions card', async () => {
      const $ = await detailPage('queried')

      expect($('[data-testid="actions-panel"]')).toHaveLength(0)
      expect($('[data-testid="case-assignment-panel"]')).toHaveLength(1)
    })

    test('the Make determination page offers Approved or Refused for a duly made application', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('duly-made')
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: DECISION_URL
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect(squash($('h1').text())).toBe('Make determination')
      expect($('[data-testid="log-decision-form"]').attr('action')).toBe(
        DECISION_URL
      )
      expect($('[data-testid="decision-approved"]')).toHaveLength(1)
      expect($('[data-testid="decision-refused"]')).toHaveLength(1)
      // AC5. The caseworker is told the determination is final.
      expect($('[data-testid="log-decision-warning"]')).toHaveLength(1)
      // AC6. The effective date, inside the group the CSS hides on Refused.
      const group = $('[data-testid="log-decision-effective-date-group"]')
      expect(group.hasClass('app-decision-form__effective-date')).toBe(true)
      expect(
        $('[data-testid="log-decision-form"]').hasClass('app-decision-form')
      ).toBe(true)
      expect(squash(group.find('legend').text())).toBe('Valid from date')
      expect(
        group.find(
          '#effective-date-day, #effective-date-month, #effective-date-year'
        )
      ).toHaveLength(3)
    })

    test('an approval without an effective date is shown again with the error', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('assessment-started')
      })

      const { statusCode, result } = await postForm(
        DECISION_URL,
        'decision=approved'
      )

      expect(statusCode).toBe(400)
      const $ = cheerio.load(result)
      expect(
        squash($('[data-testid="effective-date-error"]').text())
      ).toContain('Enter the valid from date')
      expect(recordWorkItemDecision).not.toHaveBeenCalled()
    })

    test.each([
      ['before 1 January', '31', '12', '2025', 'on or after 1 January 2026'],
      ['after 31 December', '1', '1', '2027', 'on or before 31 December 2026']
    ])(
      'an approval dated %s of the accreditation year is shown again with the year named',
      async (_, day, month, year, expected) => {
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: anItemIn('assessment-started')
        })

        const { statusCode, result } = await postForm(
          DECISION_URL,
          `decision=approved&effective-date-day=${day}&effective-date-month=${month}&effective-date-year=${year}`
        )

        expect(statusCode).toBe(400)
        const $ = cheerio.load(result)
        expect(
          squash($('[data-testid="effective-date-error"]').text())
        ).toContain(`Valid from date must be ${expected}`)
        expect(recordWorkItemDecision).not.toHaveBeenCalled()
      }
    )

    test.each([
      'submitted',
      'approved-pending-contact',
      'approved',
      'rejected'
    ])(
      'the Make determination page is refused for a %s application',
      async (stateId) => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: anItemIn(stateId) })

        const { statusCode, headers } = await server.inject({
          method: 'GET',
          url: DECISION_URL
        })

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(DETAIL_URL)
      }
    )

    test('approving records the note, starts the assessment and records the decision', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('duly-made')
      })
      applyWorkItemAction.mockResolvedValue({
        ok: true,
        workItem: anItemIn('assessment-started')
      })
      addWorkItemNote.mockResolvedValue({ ok: true })
      recordWorkItemDecision.mockResolvedValue({
        ok: true,
        workItem: anItemIn('approved-pending-contact')
      })

      const { statusCode, headers } = await postForm(
        DECISION_URL,
        'decision=approved&decisionNote=Site%20meets%20the%20conditions' +
          '&effective-date-day=1&effective-date-month=3&effective-date-year=2026'
      )

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(DETAIL_URL)
      expect(applyWorkItemAction).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ADD_ORS_ID,
          actionId: 'start-assessment'
        })
      )
      expect(addWorkItemNote).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ADD_ORS_ID,
          text: 'Site meets the conditions'
        })
      )
      expect(recordWorkItemDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ADD_ORS_ID,
          outcome: 'approved',
          effectiveDate: '2026-03-01'
        })
      )
    })

    test('refusing without a note records the decision only', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('assessment-started')
      })
      recordWorkItemDecision.mockResolvedValue({
        ok: true,
        workItem: anItemIn('rejected-pending-contact')
      })

      const { statusCode } = await postForm(DECISION_URL, 'decision=rejected')

      expect(statusCode).toBe(statusCodes.redirect)
      expect(addWorkItemNote).not.toHaveBeenCalled()
      expect(recordWorkItemDecision).toHaveBeenCalledWith(
        expect.objectContaining({ workItemId: ADD_ORS_ID, outcome: 'rejected' })
      )
    })

    test('submitting no decision re-renders the page with the error and records nothing', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('assessment-started')
      })

      const { statusCode, result } = await postForm(DECISION_URL, '')

      expect(statusCode).toBe(statusCodes.badRequest)
      const $ = cheerio.load(result)
      expect($('[data-testid="log-decision-error-summary"]')).toHaveLength(1)
      expect($('[data-testid="decision-error"]')).toHaveLength(1)
      expect(recordWorkItemDecision).not.toHaveBeenCalled()
    })

    test.each([
      ['approved-pending-contact', 'Application approved'],
      ['rejected-pending-contact', 'Application refused']
    ])(
      'a %s application shows the banner and only Confirm applicant contact',
      async (stateId, title) => {
        const $ = await detailPage(stateId)

        const banner = $(
          '[data-testid="standard-lifecycle-pending-contact-banner"]'
        )
        expect(squash(banner.text())).toContain(title)
        expect(squash(banner.text())).toContain(
          'You now need to contact the applicant about the decision.'
        )
        // No accreditation number is minted for an add-ORS approval.
        expect(
          $(
            '[data-testid="standard-lifecycle-pending-contact-accreditation-id"]'
          )
        ).toHaveLength(0)
        const cta = $('[data-testid="confirm-applicant-contact-cta"]')
        expect(cta.attr('href')).toBe(CONFIRM_URL)
        expect($('[data-testid="log-decision-cta"]')).toHaveLength(0)
        expect($('[data-testid="duly-make-cta"]')).toHaveLength(0)
        expect($('[data-testid="action-sla-extend"]')).toHaveLength(0)
        expect($('[data-testid="work-item-no-actions"]')).toHaveLength(0)
      }
    )

    test('the Confirm applicant contact page renders for a determination pending contact', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('approved-pending-contact')
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: CONFIRM_URL
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect(squash($('h1').text())).toBe('Confirm applicant contact')
      expect($('[data-testid="confirm-contact-form"]').attr('action')).toBe(
        CONFIRM_URL
      )
    })

    test('the Confirm applicant contact page is refused before a determination', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('assessment-started')
      })

      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: CONFIRM_URL
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(DETAIL_URL)
    })

    test.each([
      ['approved-pending-contact', 'approved'],
      ['rejected-pending-contact', 'rejected']
    ])(
      'confirming contact on a %s application applies the determination',
      async (stateId, closedStateId) => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: anItemIn(stateId) })
        confirmWorkItemApplicantContact.mockResolvedValue({
          ok: true,
          workItem: anItemIn(closedStateId)
        })

        const { statusCode, headers } = await postForm(
          CONFIRM_URL,
          'applicantContacted=yes'
        )

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(DETAIL_URL)
        expect(confirmWorkItemApplicantContact).toHaveBeenCalledWith(
          expect.objectContaining({ workItemId: ADD_ORS_ID })
        )
      }
    )

    test('a failed confirmation changes nothing and can be retried', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('approved-pending-contact')
      })
      confirmWorkItemApplicantContact.mockResolvedValue({
        ok: false,
        reason: 'server',
        status: 500
      })

      const { statusCode, result } = await postForm(
        CONFIRM_URL,
        'applicantContacted=yes'
      )

      expect(statusCode).toBe(statusCodes.badGateway)
      const $ = cheerio.load(result)
      expect(
        squash($('[data-testid="confirm-contact-failure-banner"]').text())
      ).toContain('Nothing has been changed. Try again.')
      expect($('[data-testid="confirm-contact-form"]').attr('action')).toBe(
        CONFIRM_URL
      )
    })

    test.each([
      ['approved', 'Granted', 'govuk-tag--green'],
      ['rejected', 'Refused', 'govuk-tag--red']
    ])(
      'a closed %s application shows its outcome, no actions and no assignment controls',
      async (stateId, label, tagClass) => {
        const $ = await detailPage(stateId)

        expect(
          $('[data-testid="standard-lifecycle-readonly-actions"]')
        ).toHaveLength(1)
        const tag = $('[data-testid="standard-lifecycle-state-tag"]')
        expect(squash(tag.text())).toBe(label)
        expect(tag.hasClass(tagClass)).toBe(true)
        expect(squash($('[data-testid="case-header-status"]').text())).toBe(
          label
        )
        for (const testId of [
          'duly-make-cta',
          'log-decision-cta',
          'confirm-applicant-contact-cta',
          'standard-lifecycle-pending-contact-banner',
          'self-assign-submit',
          'reassign-link',
          'unassign-link',
          'action-sla-extend'
        ]) {
          expect($(`[data-testid="${testId}"]`)).toHaveLength(0)
        }
        expect($('[data-testid="assignment-closed"]')).toHaveLength(1)
      }
    )
  })

  // RA-800. Correcting the valid from date of an approved add-ORS while it
  // awaits applicant contact: link, page, validation, save, cancel, guard.
  describe('changing the valid from date of an add-ORS application', () => {
    const DETAIL_URL = `/work-items/${ADD_ORS_ID}`
    const CHANGE_URL = `/work-items/add-overseas-site/${ADD_ORS_ID}/change-valid-from`
    const FORM = { 'content-type': 'application/x-www-form-urlencoded' }

    function anApprovedItem({
      stateId = 'approved-pending-contact',
      ...rest
    } = {}) {
      const base = anAddOrsItem({ assignedToName: 'Test Standard User' })
      return {
        ...base,
        assignedToId: 'test-standard-id',
        stateId,
        payload: { ...base.payload, effectiveDate: '2026-03-27', ...rest }
      }
    }

    function withoutDate() {
      const item = anApprovedItem()
      delete item.payload.effectiveDate
      return item
    }

    async function detailPage(workItem, headers = {}) {
      getWorkItem.mockResolvedValue({ ok: true, workItem })
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: DETAIL_URL,
        headers
      })
      expect(statusCode).toBe(statusCodes.ok)
      return cheerio.load(result)
    }

    async function changePage() {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anApprovedItem() })
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: CHANGE_URL
      })
      expect(statusCode).toBe(statusCodes.ok)
      return cheerio.load(result)
    }

    function post(payload) {
      return injectWithCrumb(server, {
        method: 'POST',
        url: CHANGE_URL,
        payload,
        headers: FORM
      })
    }

    function dateBody(day, month, year, reason = 'Mistyped the date') {
      return new URLSearchParams({
        'effective-date-day': day,
        'effective-date-month': month,
        'effective-date-year': year,
        reason
      }).toString()
    }

    async function followRedirect(posted) {
      expect(posted.statusCode).toBe(statusCodes.redirect)
      expect(posted.headers.location).toBe(DETAIL_URL)
      const cookie = []
        .concat(posted.headers['set-cookie'] ?? [])
        .map((header) => header.split(';')[0])
        .join('; ')
      const followed = await server.inject({
        method: 'GET',
        url: DETAIL_URL,
        headers: { cookie }
      })
      return cheerio.load(followed.result)
    }

    beforeEach(() => {
      changeValidFromWorkItem.mockReset()
    })

    describe('the link', () => {
      test('is the first link in the actions card, above Reassign and Unassign', async () => {
        const $ = await detailPage(anApprovedItem())

        const link = $('[data-testid="change-valid-from-link"]')
        expect(squash(link.text())).toBe('Change valid from date')
        expect(link.attr('href')).toBe(CHANGE_URL)
        const ids = $('.app-case-panel__links li > [data-testid]')
          .map((_, el) => $(el).attr('data-testid'))
          .get()
        expect(ids.slice(0, 3)).toEqual([
          'change-valid-from-link',
          'reassign-link',
          'unassign-link'
        ])
      })

      test('is inert for a read-only user', async () => {
        const $ = await detailPage(anApprovedItem(), {
          'x-test-user-role': 'support-readonly'
        })

        const link = $('[data-testid="change-valid-from-link"]')
        expect(link).toHaveLength(1)
        expect(link.is('a')).toBe(false)
        expect(link.attr('href')).toBeUndefined()
        expect(link.hasClass('app-action-link--disabled')).toBe(true)
      })

      test('is hidden when there is no valid from date', async () => {
        const $ = await detailPage(withoutDate())
        expect($('[data-testid="change-valid-from-link"]')).toHaveLength(0)
      })

      test.each([
        'approved',
        'rejected',
        'rejected-pending-contact',
        'duly-made'
      ])('is hidden for a %s application', async (stateId) => {
        const $ = await detailPage(anApprovedItem({ stateId }))
        expect($('[data-testid="change-valid-from-link"]')).toHaveLength(0)
      })

      test('leaves Confirm applicant contact available', async () => {
        const $ = await detailPage(anApprovedItem())
        expect($('[data-testid="confirm-applicant-contact-cta"]')).toHaveLength(
          1
        )
      })
    })

    describe('the page', () => {
      test('shows the breadcrumb, caption, current date and an empty form', async () => {
        const $ = await changePage()

        expect(squash($('h1').text())).toBe('Change valid from date')
        expect(squash($('[data-testid="app-heading-caption"]').text())).toBe(
          'Application number IYC-ORS-2026-00001'
        )
        expect($('.govuk-breadcrumbs a').first().text()).toBe('Work items')
        expect(squash($('.govuk-breadcrumbs').text())).toBe(
          'Work items IYC-ORS-2026-00001 Change valid from date'
        )
        expect(
          squash($('[data-testid="change-valid-from-current"]').text())
        ).toBe('The current valid from date is 27/03/2026')
        expect($('[data-testid="change-valid-from-form"]').attr('action')).toBe(
          CHANGE_URL
        )
        for (const part of ['day', 'month', 'year']) {
          expect($(`#effective-date-${part}`).val() ?? '').toBe('')
        }
        expect($('#reason').text().trim()).toBe('')
        expect(squash($('[for="reason"]').text())).toBe('Reason for change')
        expect($('body').text()).toContain(
          'The reason for change will be recorded in the audit log (application history)'
        )
        expect($('body').text()).toContain('You can enter up to 200 words')
        expect($('[data-testid="change-valid-from-cancel"]').attr('href')).toBe(
          DETAIL_URL
        )
        // No client-side JavaScript of its own: Cancel is a link, Save a
        // plain form post.
        expect($('[data-testid="change-valid-from-form"] script')).toHaveLength(
          0
        )
      })

      test.each([
        'duly-made',
        'approved',
        'rejected',
        'approved-pending-contact-no-date'
      ])('is refused for a %s application', async (stateId) => {
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem:
            stateId === 'approved-pending-contact-no-date'
              ? withoutDate()
              : anApprovedItem({ stateId })
        })

        const { statusCode, headers } = await server.inject({
          method: 'GET',
          url: CHANGE_URL
        })

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(DETAIL_URL)
      })

      test('is refused when a POST arrives for an ineligible application', async () => {
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: anApprovedItem({ stateId: 'approved' })
        })

        const posted = await post(dateBody('1', '4', '2026'))

        expect(posted.statusCode).toBe(statusCodes.redirect)
        expect(posted.headers.location).toBe(DETAIL_URL)
        expect(changeValidFromWorkItem).not.toHaveBeenCalled()
      })

      test('is not found for an unknown application', async () => {
        getWorkItem.mockResolvedValue({ ok: false, status: 404 })

        const { statusCode } = await server.inject({
          method: 'GET',
          url: CHANGE_URL
        })

        expect(statusCode).toBe(statusCodes.notFound)
      })

      test('is not found for a re-accreditation item', async () => {
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: aReAccreditationItem()
        })

        const { statusCode, headers } = await server.inject({
          method: 'GET',
          url: CHANGE_URL
        })

        expect(statusCode).toBe(statusCodes.redirect)
        expect(headers.location).toBe(DETAIL_URL)
      })
    })

    describe('validation', () => {
      test.each([
        ['missing', '', '', '', 'Enter the valid from date'],
        [
          'not a real date',
          '31',
          '2',
          '2026',
          'Valid from date must be a real date'
        ],
        [
          'before the accreditation year',
          '31',
          '12',
          '2025',
          'Valid from date must be on or after 1 January 2026'
        ],
        [
          'after the accreditation year',
          '1',
          '1',
          '2027',
          'Valid from date must be on or before 31 December 2026'
        ]
      ])(
        'a %s date shows an error and keeps the input',
        async (_, d, m, y, message) => {
          getWorkItem.mockResolvedValue({
            ok: true,
            workItem: anApprovedItem()
          })

          const { statusCode, result } = await post(
            dateBody(d, m, y, 'Because')
          )

          expect(statusCode).toBe(statusCodes.badRequest)
          const $ = cheerio.load(result)
          expect(
            squash($('[data-testid="change-valid-from-error-summary"]').text())
          ).toContain(message)
          expect(
            $('[data-testid="change-valid-from-error-summary"] a').attr('href')
          ).toBe('#effective-date-day')
          expect($('#effective-date-day').val()).toBe(d)
          expect($('#effective-date-month').val()).toBe(m)
          expect($('#effective-date-year').val()).toBe(y)
          expect($('#reason').text().trim()).toBe('Because')
          expect(
            squash($('[data-testid="change-valid-from-current"]').text())
          ).toBe('The current valid from date is 27/03/2026')
          expect(changeValidFromWorkItem).not.toHaveBeenCalled()
        }
      )

      test('a missing reason shows an error and keeps the date', async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: anApprovedItem() })

        const { statusCode, result } = await post(
          dateBody('1', '4', '2026', '  ')
        )

        expect(statusCode).toBe(statusCodes.badRequest)
        const $ = cheerio.load(result)
        expect(
          squash($('[data-testid="change-valid-from-error-summary"]').text())
        ).toContain('Enter a reason for the valid from date change')
        expect($('#effective-date-day').val()).toBe('1')
        expect($('#effective-date-year').val()).toBe('2026')
        expect(changeValidFromWorkItem).not.toHaveBeenCalled()
      })

      test('a reason over 200 words shows an error and keeps the reason', async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: anApprovedItem() })
        const reason = Array.from({ length: 201 }, () => 'word').join(' ')

        const { statusCode, result } = await post(
          dateBody('1', '4', '2026', reason)
        )

        expect(statusCode).toBe(statusCodes.badRequest)
        const $ = cheerio.load(result)
        expect(
          squash($('[data-testid="change-valid-from-error-summary"]').text())
        ).toContain('Reason must be 200 words or fewer')
        expect($('#reason').text().trim()).toBe(reason)
        expect(changeValidFromWorkItem).not.toHaveBeenCalled()
      })

      test('shows every problem at once', async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: anApprovedItem() })

        const { result } = await post(dateBody('', '', '', ''))

        const $ = cheerio.load(result)
        expect(
          $('[data-testid="change-valid-from-error-summary"] li')
        ).toHaveLength(2)
      })

      test.each([
        [
          'effective-date-before-year-start',
          'Valid from date must be on or after 1 January 2026'
        ],
        ['effective-date-reason-too-long', 'Reason must be 200 words or fewer']
      ])(
        'maps the backend code %s back onto its field',
        async (errorCode, message) => {
          getWorkItem.mockResolvedValue({
            ok: true,
            workItem: anApprovedItem()
          })
          changeValidFromWorkItem.mockResolvedValue({
            ok: false,
            reason: 'invalid',
            status: 400,
            errorCode,
            message: 'developer detail'
          })

          const { statusCode, result } = await post(dateBody('1', '4', '2026'))

          expect(statusCode).toBe(statusCodes.badRequest)
          const $ = cheerio.load(result)
          expect(
            squash($('[data-testid="change-valid-from-error-summary"]').text())
          ).toContain(message)
          expect(result).not.toContain('developer detail')
        }
      )
    })

    describe('saving', () => {
      test('sends the date and reason, then returns to the summary with the Updated banner', async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: anApprovedItem() })
        changeValidFromWorkItem.mockResolvedValue({
          ok: true,
          workItem: anApprovedItem()
        })

        const $ = await followRedirect(
          await post(dateBody('2', '4', '2026', 'Mistyped the date'))
        )

        expect(changeValidFromWorkItem).toHaveBeenCalledWith(
          expect.objectContaining({
            workItemId: ADD_ORS_ID,
            effectiveDate: '2026-04-02',
            reason: 'Mistyped the date'
          })
        )
        const banner = $('[data-testid="work-item-flash-banner"]')
        expect(squash(banner.text())).toContain('Updated')
        expect(squash(banner.text())).toContain(
          'Valid from date updated to 02/04/2026. You now need to contact the applicant about the decision.'
        )
        // Status unchanged and the next step is still Confirm applicant contact.
        expect($('[data-testid="confirm-applicant-contact-cta"]')).toHaveLength(
          1
        )
        expect(applyWorkItemAction).not.toHaveBeenCalled()
      })

      test('accepts the same date as the current one', async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: anApprovedItem() })
        changeValidFromWorkItem.mockResolvedValue({
          ok: true,
          workItem: anApprovedItem()
        })

        const posted = await post(dateBody('27', '3', '2026'))

        expect(posted.statusCode).toBe(statusCodes.redirect)
        expect(changeValidFromWorkItem).toHaveBeenCalledWith(
          expect.objectContaining({ effectiveDate: '2026-03-27' })
        )
      })

      test.each([
        [
          { ok: false, reason: 'conflict', status: 409 },
          'can no longer be changed'
        ],
        [{ ok: false, reason: 'not-found', status: 404 }, 'could not be found'],
        [{ ok: false, reason: 'server', status: 500 }, 'There was a problem']
      ])(
        'turns a backend failure into a banner on the summary',
        async (failure, text) => {
          getWorkItem.mockResolvedValue({
            ok: true,
            workItem: anApprovedItem()
          })
          changeValidFromWorkItem.mockResolvedValue(failure)

          const $ = await followRedirect(await post(dateBody('2', '4', '2026')))

          const banner = $('[data-testid="work-item-flash-banner"]')
          expect(squash(banner.text())).toContain(
            'Could not change the valid from date'
          )
          expect(squash(banner.text())).toContain(text)
        }
      )
    })

    describe('cancelling', () => {
      test('is a plain link back to the summary and sends nothing', async () => {
        const $ = await changePage()

        const cancel = $('[data-testid="change-valid-from-cancel"]')
        expect(cancel.is('a')).toBe(true)
        expect(cancel.attr('href')).toBe(DETAIL_URL)
        expect(changeValidFromWorkItem).not.toHaveBeenCalled()
      })
    })
  })

  describe('Application history page', () => {
    // RA-495 AC3. The entries are management-be's; the page lists each.
    test('lists the assignment and due date changes', async () => {
      const item = anAddOrsItem()
      item.auditLog = [
        {
          id: 'e0000003-0000-4000-8000-000000000000',
          action: 'sla-extended',
          actionDisplayName: 'Determination deadline extended',
          stateId: 'assessment-in-progress',
          details: {
            reason: 'Waiting on evidence',
            additionalDuration: 'P35D'
          },
          createdAt: '2027-03-01T09:00:00Z'
        },
        {
          id: 'e0000002-0000-4000-8000-000000000000',
          action: 'unassigned',
          actionDisplayName: 'Unassigned',
          stateId: 'submitted',
          details: {},
          createdAt: '2027-02-13T09:00:00Z'
        },
        {
          id: 'e0000001-0000-4000-8000-000000000000',
          action: 'assigned',
          actionDisplayName: 'Assigned',
          stateId: 'submitted',
          details: { assigneeName: 'Stub Caseworker One' },
          createdAt: '2027-02-12T09:00:00Z'
        }
      ]
      getWorkItem.mockResolvedValue({ ok: true, workItem: item })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ADD_ORS_ID}/audit-log`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect(
        $('[data-testid="work-item-audit-log"] > li')
          .map((_, el) => $(el).attr('data-action'))
          .get()
      ).toEqual(['sla-extended', 'unassigned', 'assigned'])
      expect($('[data-testid="work-item-audit-log"]').text()).toContain(
        'Waiting on evidence'
      )
    })

    // RA-795 AC08. The valid from date set on approval shows on the
    // determination entry; a refusal records none, so shows no such row.
    describe.each([
      [
        'an approval',
        {
          actionDisplayName: 'Determination made: Approved',
          details: { outcome: 'approved', effectiveDate: '2027-06-01' }
        },
        true
      ],
      [
        'a refusal',
        {
          actionDisplayName: 'Determination made: Refused',
          details: { outcome: 'rejected' }
        },
        false
      ]
    ])('the determination entry for %s', (_, entry, showsValidFrom) => {
      test(
        showsValidFrom
          ? 'shows the valid from date, user and timestamp'
          : 'shows no valid from date row',
        async () => {
          const item = anAddOrsItem()
          item.auditLog = [
            {
              id: 'e0000004-0000-4000-8000-000000000000',
              action: 'determination-made',
              stateId: 'approved-pending-contact',
              createdBy: 'user-1',
              createdByName: 'Reg Ulator',
              createdAt: '2027-03-01T09:00:00Z',
              ...entry
            }
          ]
          getWorkItem.mockResolvedValue({ ok: true, workItem: item })

          const { result, statusCode } = await server.inject({
            method: 'GET',
            url: `/work-items/${ADD_ORS_ID}/audit-log`
          })

          expect(statusCode).toBe(statusCodes.ok)
          const $ = cheerio.load(result)
          const text = squash(
            $('[data-testid="work-item-audit-log"] > li').text()
          )
          expect(text).toContain(entry.actionDisplayName)
          expect(text).toContain('1 March 2027')
          if (showsValidFrom) {
            expect(text).toContain('Valid from date 01/06/2027')
            expect(text).toContain('Determined by Reg Ulator')
          } else {
            expect(text).not.toContain('Valid from date')
          }
        }
      )
    })

    test('shows the add-ORS header and tabs', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ADD_ORS_ID}/audit-log`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect($('[data-testid="case-header-caption"]')).toHaveLength(0)
      expect($('[data-testid="case-header-accreditation-ref"]').text()).toBe(
        'IYC-ORS-2026-00001'
      )
      expect(squash($('[data-testid="case-header-title"]').text())).toBe(
        'Denmark PR (007)'
      )
      expect($('[data-testid="case-header-org-name"]')).toHaveLength(0)
      expect(squash($('[data-testid="case-header-request-type"]').text())).toBe(
        'New ORS accreditation'
      )
      expect(squash($('[data-testid="case-header-status"]').text())).toBe(
        'Not started'
      )
      expect(squash($('[data-testid="case-header-charge"]').text())).toBe(
        '£328.00'
      )
      expect(tabs($)).toEqual(addOrsTabs('application-history'))
    })
  })

  // RA-495. Related applications (RA-770) is a tab of an add-ORS case with
  // nothing in it yet. The Accreditation summary tab (RA-769) has its own
  // tests in `accreditation-summary.route.test.js`.
  describe.each([['Related applications', 'related-applications']])(
    '%s tab',
    (_, tabKey) => {
      const url = `/work-items/${ADD_ORS_ID}/${tabKey}`

      test('renders an empty tab under the add-ORS header, with itself active', async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

        const { result, statusCode } = await server.inject({
          method: 'GET',
          url
        })

        expect(statusCode).toBe(statusCodes.ok)
        const $ = cheerio.load(result)
        expect(squash($('[data-testid="case-header-title"]').text())).toBe(
          'Denmark PR (007)'
        )
        expect($('[data-testid="case-header-site-id"]')).toHaveLength(0)
        expect(tabs($)).toEqual(addOrsTabs(tabKey))
        const panel = $(`[data-testid="${tabKey}-tab"]`)
        expect(panel).toHaveLength(1)
        expect(squash(panel.text())).toBe('')
        expect($('[data-testid="case-assignment-panel"]')).toHaveLength(0)
      })

      test('is not found for a re-accreditation item', async () => {
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: aReAccreditationItem()
        })

        const response = await server.inject({
          method: 'GET',
          url: `/work-items/${RE_ACCREDITATION_ID}/${tabKey}`
        })

        expect(response.statusCode).toBe(statusCodes.notFound)
        expect(squash(cheerio.load(response.result)('h1').text())).toBe(
          'Application not found'
        )
      })

      test('is not found for an unknown work item', async () => {
        getWorkItem.mockResolvedValue({ ok: false, status: 404 })

        const response = await server.inject({ method: 'GET', url })

        expect(response.statusCode).toBe(statusCodes.notFound)
      })
    }
  )

  // df7.21. The re-accreditation-only tab pages are not part of an in-year
  // change's case: opened by URL they 404 exactly like an unknown work item.
  describe('re-accreditation-only pages', () => {
    const siteId = 'site-1'

    async function expectApplicationNotFound(response) {
      expect(response.statusCode).toBe(statusCodes.notFound)
      const $ = cheerio.load(response.result)
      expect(squash($('h1').text())).toBe('Application not found')
      expect($('[data-testid="work-item-not-found"]')).toHaveLength(1)
      expect($('[data-testid="case-header-title"]')).toHaveLength(0)
    }

    test.each([
      ['Additional information', 'additional-information'],
      ['Recycling operations', 'recycling-operations'],
      ['Change recycling operations', `recycling-operations/${siteId}`]
    ])('%s is not found for an add-ORS item', async (_, path) => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

      await expectApplicationNotFound(
        await server.inject({
          method: 'GET',
          url: `/work-items/${ADD_ORS_ID}/${path}`
        })
      )
    })

    test('saving recycling operations is not found for an add-ORS item', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

      await expectApplicationNotFound(
        await injectWithCrumb(server, {
          method: 'POST',
          url: `/work-items/${ADD_ORS_ID}/recycling-operations/${siteId}`,
          payload: 'codes=R5',
          headers: { 'content-type': 'application/x-www-form-urlencoded' }
        })
      )
      expect(updateRecyclingOperations).not.toHaveBeenCalled()
    })

    test.each([
      ['Additional information', 'additional-information'],
      ['Recycling operations', 'recycling-operations']
    ])('%s still renders for a re-accreditation item', async (_, path) => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aReAccreditationItem()
      })

      const { statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${RE_ACCREDITATION_ID}/${path}`
      })

      expect(statusCode).toBe(statusCodes.ok)
    })
  })
})
