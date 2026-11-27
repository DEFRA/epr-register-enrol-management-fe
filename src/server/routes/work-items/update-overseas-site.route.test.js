/**
 * RA-681. An ORS update (`update-overseas-site`, RA-682) is an in-year change
 * on the Standard workflow, like add-ORS. Its request type label is worked
 * out from its site's `selected` flag: "Accreditation: ORS update" for an
 * approved ORS, "Registration: ORS update" for a registration-only one, and
 * management-be's "ORS update" for an item submitted before the operator
 * backend sent the flag.
 *
 * The full update detail page (previous and proposed details, lifecycle
 * actions) is the next Case Management service ticket's. Until then the detail page loads with the
 * update's header and label.
 *
 * Route-level: the real server and module declarations, only the backend
 * API mocked.
 */
import { vi } from 'vitest'
import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getAccreditationSummary: vi.fn(),
  getWorkItems: vi.fn(),
  getRelatedWorkItems: vi.fn(),
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

const { getWorkItem, getWorkItems } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const UPDATE_ORS_ID = '68100006-0000-4000-8000-000000000001'
const EM_DASH = '—'

function anUpdateOrsItem({ selected } = {}) {
  const site = {
    siteId: 'site-1',
    orsId: '007',
    siteName: 'Denmark PR',
    addressLine1: 'Ejbyvvej 12',
    townOrCity: 'Copenhagen',
    country: 'Denmark',
    contactName: 'John Smith',
    chargePence: 0,
    previous: { contactName: 'John Smith' },
    proposed: { contactName: 'Jane Smith' },
    interimSiteChanges: []
  }
  if (selected !== undefined) {
    site.selected = selected
  }
  return {
    id: UPDATE_ORS_ID,
    typeId: 'update-overseas-site',
    stateId: 'submitted',
    templateVersion: 'v1',
    submittedAt: '2027-02-11T10:00:00Z',
    lastModifiedAt: '2027-02-11T10:00:00Z',
    assignedToId: null,
    assignedToName: null,
    slaDueDate: null,
    slaState: null,
    payload: {
      operatorRequestId: 'request-1:update-overseas-site',
      changeType: 'update-overseas-site',
      organisationName: 'GreenLoop Recovery',
      operatorOrgNumber: 123001,
      material: 'Plastic',
      accreditationYear: 2026,
      applicationReference: 'IYC-ORS-2026-00002',
      submissionReference: 'SUB-2026-0002',
      submissionSize: 1,
      accreditationReference: 'ACC-REP-PL-0007',
      chargePence: 0,
      submittedBy: { fullName: 'Sam Operator' },
      site
    },
    availableActions: []
  }
}

function squash(text) {
  return text.replace(/\s+/g, ' ').trim()
}

const LABEL_CASES = [
  ['an approved ORS', true, 'Accreditation: ORS update'],
  ['a registration-only ORS', false, 'Registration: ORS update'],
  ['an item submitted without the flag', undefined, 'ORS update']
]

let server

describe('RA-681: ORS update applications', () => {
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

  describe('Applications list card', () => {
    async function card(item) {
      getWorkItems.mockResolvedValue({
        ok: true,
        items: [item],
        totalCount: 1,
        page: 1,
        pageSize: 20
      })
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })
      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      return { $, card: $(`[data-work-item-id="${UPDATE_ORS_ID}"]`) }
    }

    test.each(LABEL_CASES)(
      'names the request type of %s',
      async (_, selected, label) => {
        const { $, card: tile } = await card(anUpdateOrsItem({ selected }))

        expect(squash(tile.find('[data-testid="request-type"]').text())).toBe(
          `Request type: ${label}`
        )
        expect($.text()).not.toContain('update-overseas-site')
      }
    )

    test('shows the site line in place of the registration number', async () => {
      const { card: tile } = await card(anUpdateOrsItem({ selected: true }))

      expect(squash(tile.find('[data-testid="application-site"]').text())).toBe(
        'Denmark PR (007)'
      )
      expect(tile.find('[data-testid="registration-number"]')).toHaveLength(0)
      expect(tile.text()).toContain('Submitted on:')
      expect(
        squash(
          tile
            .find(`[data-testid="work-item-state-tag-${UPDATE_ORS_ID}"]`)
            .text()
        )
      ).toBe('Not started')
    })
  })

  describe('detail page', () => {
    async function detailPage(item, path = '') {
      getWorkItem.mockResolvedValue({ ok: true, workItem: item })
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${UPDATE_ORS_ID}${path}`
      })
      expect(statusCode).toBe(statusCodes.ok)
      return cheerio.load(result)
    }

    test.each(LABEL_CASES)(
      'names the request type of %s in the case header',
      async (_, selected, label) => {
        const $ = await detailPage(anUpdateOrsItem({ selected }))

        expect(
          squash($('[data-testid="case-header-request-type"]').text())
        ).toBe(label)
      }
    )

    test('titles the header with the site and ORS id, with no charge or payment date', async () => {
      const $ = await detailPage(anUpdateOrsItem({ selected: false }))

      expect(squash($('[data-testid="case-header-title"]').text())).toBe(
        'Denmark PR (007)'
      )
      expect($('[data-testid="case-header-accreditation-ref"]').text()).toBe(
        'IYC-ORS-2026-00002'
      )
      const meta = $(
        '[data-testid="case-header-meta"] .app-case-header__meta-item'
      )
        .map((_, el) => squash($(el).text()))
        .get()
      expect(meta).toEqual([
        'Application type: Registration: ORS update',
        'Status: Not started',
        'Assigned to: Unassigned',
        `Due date: ${EM_DASH}`,
        'Accreditation number: ACC-REP-PL-0007',
        'Material: Plastic',
        'Submitted by: Sam Operator',
        'Submitted on: 11 Feb 2027'
      ])
    })

    test('has the Application summary and Application history tabs, and no actions', async () => {
      const $ = await detailPage(anUpdateOrsItem({ selected: true }))

      expect(
        $('[data-testid="case-tabs"] [data-testid^="tab-"]')
          .map((_, el) => $(el).attr('data-testid'))
          .get()
      ).toEqual(['tab-application-summary', 'tab-application-history'])
      expect($('[data-testid="update-overseas-site-detail"]')).toHaveLength(1)
      expect($('[data-testid="re-accreditation-detail"]')).toHaveLength(0)
      expect($('[data-testid="work-item-actions"]')).toHaveLength(0)
      expect(squash($('[data-testid="application-details"]').text())).toContain(
        'Denmark PR'
      )
    })

    test('names the request type on the Application history page', async () => {
      const $ = await detailPage(
        anUpdateOrsItem({ selected: true }),
        '/audit-log'
      )

      expect(squash($('[data-testid="case-header-request-type"]').text())).toBe(
        'Accreditation: ORS update'
      )
      expect(squash($('[data-testid="case-header-title"]').text())).toBe(
        'Denmark PR (007)'
      )
    })
  })
})
