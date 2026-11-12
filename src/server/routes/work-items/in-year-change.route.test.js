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

const { getWorkItem, getWorkItems } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

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
      site: {
        siteId: 'site-1',
        orsId: '007',
        siteName: 'Denmark PR',
        chargePence: 32800
      }
    },
    availableActions: []
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
        '11 Feb 2027'
      )
      expect(
        squash(card.find('[data-testid="submission-reference"]').text())
      ).toBe('SUB-2026-0001 (3 requests)')
      const link = card.find(`[data-testid="work-item-link-${ADD_ORS_ID}"]`)
      expect(link.attr('href')).toBe(`/work-items/${ADD_ORS_ID}`)
      expect(squash(link.text())).toBe('IYC-ORS-2026-00001')
      expect(squash(card.find('[data-testid="application-org"]').text())).toBe(
        'GreenLoop Recovery (123001): Plastic'
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
      expect(card.text()).toContain('Date submitted:')
    })

    test('says "(1 request)" for a single-site submission', async () => {
      const $ = await listPage(anAddOrsItem({ submissionSize: 1 }))

      expect(squash($('[data-testid="submission-reference"]').text())).toBe(
        'SUB-2026-0001 (1 request)'
      )
    })

    test('names the assigned officer', async () => {
      const $ = await listPage(anAddOrsItem({ assignedToName: 'Jo Officer' }))

      expect(squash($('[data-testid="application-assigned-to"]').text())).toBe(
        'Assigned to: Jo Officer'
      )
    })

    test('has no registration number, applicant type or due date line', async () => {
      const $ = await listPage(anAddOrsItem())
      const card = $(`[data-work-item-id="${ADD_ORS_ID}"]`)

      expect(card.find('[data-testid="registration-number"]')).toHaveLength(0)
      expect(card.find('[data-testid="applicant-type"]')).toHaveLength(0)
      expect(card.find('[data-testid="due-on"]')).toHaveLength(0)
    })

    test('keeps the re-accreditation card beside it unchanged', async () => {
      const $ = await listPage(anAddOrsItem(), aReAccreditationItem())
      const card = $(`[data-work-item-id="${RE_ACCREDITATION_ID}"]`)

      expect(card.find('[data-testid="registration-number"]').text()).toBe(
        'EPR-100999'
      )
      expect(card.find('[data-testid="applicant-type"]').text()).toBe(
        'Reprocessor'
      )
      expect(card.find('[data-testid="submission-reference"]')).toHaveLength(0)
      expect(card.find('[data-testid="request-type"]')).toHaveLength(0)
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
        'Charge: £328.00',
        'Payment date: Not received'
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
        '£328.00'
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

  describe('Additional information page', () => {
    test('shows the add-ORS header', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ADD_ORS_ID}/additional-information`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect(squash($('[data-testid="case-header-title"]').text())).toBe(
        'Denmark PR (007)'
      )
      expect(squash($('[data-testid="case-header-request-type"]').text())).toBe(
        'New ORS accreditation'
      )
    })
  })
})
