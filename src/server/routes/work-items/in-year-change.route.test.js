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
  getWorkItems: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  updateRecyclingOperations: vi.fn()
}))

const {
  getWorkItem,
  getWorkItems,
  assignWorkItem,
  applyWorkItemAction,
  updateRecyclingOperations
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
    templateVersion: 'v1',
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

let server

describe('RA-739: in-year change applications', () => {
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
    applyWorkItemAction.mockReset()
    updateRecyclingOperations.mockReset()
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

    test('captions the header with the reference and titles it with the site and ORS id', async () => {
      const $ = await detailPage(anAddOrsItem())

      expect($('[data-testid="add-overseas-site-detail"]')).toHaveLength(1)
      expect(squash($('[data-testid="case-header-caption"]').text())).toBe(
        'IYC-ORS-2026-00001'
      )
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

    test('shows the eight meta items in Figma order with the site charge', async () => {
      const $ = await detailPage(anAddOrsItem())

      const meta = $(
        '[data-testid="case-header-meta"] .app-case-header__meta-item'
      )
        .map((_, el) => squash($(el).text()))
        .get()
      expect(meta).toEqual([
        'Request type: New ORS accreditation',
        'Status: Not started',
        'Assigned to: Unassigned',
        `Due date: ${EM_DASH}`,
        'Material: Plastic',
        'Accreditation number: ACC-REP-PL-0007',
        'Charge: £328',
        'Payment date: Not received'
      ])
      // Its own column widths (Figma: the second column holds the
      // accreditation number, too long for re-accreditation's narrow one).
      expect(
        $('[data-testid="case-header-meta"]').hasClass(
          'app-case-header__meta--in-year-change'
        )
      ).toBe(true)
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
      delete item.payload.site.chargePence
      const $ = await detailPage(item)

      expect(squash($('[data-testid="case-header-material"]').text())).toBe(
        EM_DASH
      )
      expect(
        squash($('[data-testid="case-header-accreditation-number"]').text())
      ).toBe(EM_DASH)
      expect(squash($('[data-testid="case-header-charge"]').text())).toBe(
        EM_DASH
      )
    })

    test('shows the payment date once it is recorded', async () => {
      const item = anAddOrsItem()
      item.payload.paymentDate = '2027-02-20'
      const $ = await detailPage(item)

      expect(squash($('[data-testid="case-header-payment-date"]').text())).toBe(
        '20 Feb 2027'
      )
    })

    test('shows only the Application summary and Application history tabs', async () => {
      const $ = await detailPage(anAddOrsItem())

      expect(tabs($)).toEqual([
        {
          key: 'application-summary',
          text: 'Application summary',
          href: null
        },
        {
          key: 'application-history',
          text: 'Application history',
          href: `/work-items/${ADD_ORS_ID}/audit-log`
        }
      ])
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

    test('shows every site row with its Figma label, in order', async () => {
      const $ = await summaryPage(anAddOrsItem())

      const rows = summaryRows($)
      expect(rows.map((row) => row.label)).toEqual([
        'Site name',
        'Location',
        'Coordinates',
        'Contact name',
        'Contact email',
        'Contact phone number',
        'Recycling operation',
        'Basel convention codes',
        'Arrangements for rejected or returned loads',
        'Conditions of export',
        'Evidence of broadly equivalent standards'
      ])
      expect(rows.slice(0, 10).map((row) => row.value)).toEqual([
        'Denmark PR',
        'Ejbyvvej 12, Industrial Park, Copenhagen, Denmark',
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

    test('answers No when the conditions of export are not met', async () => {
      const item = anAddOrsItem()
      item.payload.site.conditionsOfExport = false
      const $ = await summaryPage(item)

      expect(squash(rowValue($, 'conditions-of-export').text())).toBe('No')
    })

    test('shows a dash for each missing value', async () => {
      const item = anAddOrsItem()
      item.payload.site = { orsId: '007', siteName: 'Denmark PR' }
      const $ = await summaryPage(item)

      const rows = summaryRows($)
      expect(rows).toHaveLength(11)
      expect(rows[0].value).toBe('Denmark PR')
      for (const row of rows.slice(1)) {
        expect(row.value, row.label).toBe(EM_DASH)
      }
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
      expect(
        squash(site.find('[data-testid="interim-site-summary-address"]').text())
      ).toBe('Havnegade 1, Denmark')
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
        ['Operation code', 'R13']
      ])
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

    test('has the assignment panel and no Duly make, Query or decision actions', async () => {
      const item = anAddOrsItem()
      // Even if the backend projects actions, none render until RA-495.
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

      expect($('[data-testid="actions-panel"]')).toHaveLength(0)
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

    test('does not show ORS ID, EU or OECD rows, or a supplied-value marker', async () => {
      const $ = await summaryPage(anAddOrsItem())
      const summary = $('[data-testid="application-details"]').text()

      expect(summary).not.toContain('ORS ID')
      expect(summary).not.toContain('EU country')
      expect(summary).not.toContain('OECD country')
      expect($('.app-new-flag')).toHaveLength(0)
    })
  })

  describe('Application history page', () => {
    test('shows the add-ORS header and tabs', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ADD_ORS_ID}/audit-log`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect(squash($('[data-testid="case-header-caption"]').text())).toBe(
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
        '£328'
      )
      expect(tabs($)).toEqual([
        {
          key: 'application-summary',
          text: 'Application summary',
          href: `/work-items/${ADD_ORS_ID}`
        },
        {
          key: 'application-history',
          text: 'Application history',
          href: null
        }
      ])
    })
  })

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
