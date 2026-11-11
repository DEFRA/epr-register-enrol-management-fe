/**
 * RA-739. An add-ORS (`add-overseas-site`) work item is an in-year change:
 * the Applications list renders it with the in-year change card variant, and
 * its detail link opens a header-only page.
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
  applicationReference = 'IYC-ORS-2026-00001'
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
    payload: {
      operatorRequestId: 'request-1',
      organisationName: 'GreenLoop Recovery',
      operatorOrgNumber: 123001,
      material: 'Plastic',
      accreditationYear: 2026,
      applicationReference,
      submissionReference: 'SUB-2026-0001',
      submissionSize,
      paymentReference: 'PR/PK/REP/123001',
      site: { siteId: 'site-1', orsId: '007', siteName: 'Denmark PR' }
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
    test('renders only the case header', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ADD_ORS_ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect($('[data-testid="add-overseas-site-detail"]')).toHaveLength(1)
      expect($('[data-testid="case-header-accreditation-ref"]').text()).toBe(
        'IYC-ORS-2026-00001'
      )
      expect($('[data-testid="case-header-org-name"]').text()).toBe(
        'GreenLoop Recovery'
      )
      expect($('[data-testid="case-header-org-id"]').text()).toBe('123001')
      expect(squash($('[data-testid="case-header-request-type"]').text())).toBe(
        'New ORS accreditation'
      )
      expect(squash($('[data-testid="case-header-status"]').text())).toBe(
        'Not started'
      )
      expect(squash($('[data-testid="case-header-assigned-to"]').text())).toBe(
        'Unassigned'
      )
      // Only the request type, status and assigned to in the meta line.
      expect(
        $('[data-testid="case-header-meta"] dd')
          .map((_, el) => $(el).attr('data-testid'))
          .get()
      ).toEqual([
        'case-header-request-type',
        'case-header-status',
        'case-header-assigned-to'
      ])
      // No re-accreditation panels or tabs.
      expect($('[data-testid="re-accreditation-detail"]')).toHaveLength(0)
      expect($('.app-case-tabs, [data-testid="case-tabs"]')).toHaveLength(0)
      expect($('[data-testid="work-item-actions"]')).toHaveLength(0)
    })
  })
})
