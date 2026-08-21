import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import {
  buildRecyclingOperationsSite,
  readFlashBanner
} from './recycling-operations.controller.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  updateRecyclingOperations: vi.fn()
}))

const { getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '11111111-1111-1111-1111-111111111111'

function aWorkItem(overrides = {}) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    payload: {
      applicantName: 'Acme',
      applicationReference: 'RA-000000001',
      material: 'glass',
      overseasSites: { sites: [] }
    },
    availableActions: [],
    auditLog: [],
    ...overrides
  }
}

function registerReaccreditation() {
  registerWorkItemType({
    id: 're-accreditation',
    displayName: 'Re-accreditation',
    initialState: { id: 'submitted', displayName: 'Submitted' },
    states: [
      { id: 'submitted', displayName: 'Submitted' },
      { id: 'approved', displayName: 'Approved', isTerminal: true }
    ],
    getTasksForState: () => []
  })
}

function anOrsSite(overrides = {}) {
  return {
    siteId: 'site-1',
    siteName: 'Zebra Reprocessing',
    operationCodes: ['R3'],
    ...overrides
  }
}

describe('#workItemRecyclingOperationsController', () => {
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
    clearWorkItemRegistry()
  })

  test('AC1: renders a real bookmarkable page for the Recycling operations tab', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkItem).toHaveBeenCalledWith({
      workItemId: ID,
      user: expect.anything()
    })
    expect(result).toContain('Recycling operations')
  })

  test('AC2: sites are sorted alphabetically by name regardless of payload order', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [
              anOrsSite({ siteId: 's3', siteName: 'Zebra Site' }),
              anOrsSite({ siteId: 's1', siteName: 'Alpha Site' }),
              anOrsSite({ siteId: 's2', siteName: 'Middle Site' })
            ]
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    const alphaIndex = result.indexOf('Alpha Site')
    const middleIndex = result.indexOf('Middle Site')
    const zebraIndex = result.indexOf('Zebra Site')
    expect(alphaIndex).toBeGreaterThan(-1)
    expect(alphaIndex).toBeLessThan(middleIndex)
    expect(middleIndex).toBeLessThan(zebraIndex)
  })

  test('AC6: renders each code with its full human-readable label', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [anOrsSite({ operationCodes: ['R5'] })]
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(result).toContain(
      'R5 — Recycling/reclamation of other inorganic materials'
    )
  })

  test('AC6: shows the associated interim site name when R12/R13 is set', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [
              anOrsSite({
                operationCodes: ['R5', 'R12'],
                interimSite: { siteName: 'Interim Depot', townOrCity: 'Lyon' }
              })
            ]
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(result).toContain('Interim Depot')
  })

  test('does not show an interim site when only R3/R4/R5 are set', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [
              anOrsSite({
                operationCodes: ['R5'],
                interimSite: { siteName: 'Should Not Render' }
              })
            ]
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(result).not.toContain('Should Not Render')
  })

  test('AC7: a site with zero codes states this clearly', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [anOrsSite({ operationCodes: [] })]
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(result).toContain('No recycling operation codes are set')
  })

  test('AC8: a support-readonly session sees an inert span, not a live Change link', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: [anOrsSite()] }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`,
      headers: { 'x-test-user-role': 'support-readonly' }
    })

    expect(result).toContain('aria-disabled="true"')
    expect(result).not.toMatch(
      /<a[^>]*data-testid="recycling-operations-site-change-site-1"/
    )
  })

  test('a standard-role session sees a live Change link', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: [anOrsSite()] }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(result).toMatch(
      /<a[^>]*href="\/work-items\/[^"]+\/recycling-operations\/site-1\/edit"[^>]*data-testid="recycling-operations-site-change-site-1"/
    )
  })

  test('returns 404 for a non-existent work item', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('returns 502 when the backend is unavailable', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 500, error: 'boom' })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(statusCode).toBe(statusCodes.badGateway)
  })
})

describe('buildRecyclingOperationsSite', () => {
  test('falls back to an em dash for a missing site name', () => {
    const view = buildRecyclingOperationsSite({ siteId: 's1' }, ID)
    expect(view.siteName).toBe('—')
  })

  test('omits the interim site when the ORS has none, even with R12/R13', () => {
    const view = buildRecyclingOperationsSite(
      { siteId: 's1', operationCodes: ['R12'] },
      ID
    )
    expect(view.interimSite).toBeNull()
  })

  test('omits the audit line when neither updatedBy nor updatedAt is present', () => {
    const view = buildRecyclingOperationsSite({ siteId: 's1' }, ID)
    expect(view.lastEdited).toBeNull()
  })

  test('includes the audit line when the backend supplies edit provenance', () => {
    const view = buildRecyclingOperationsSite(
      {
        siteId: 's1',
        recyclingOperationsUpdatedBy: 'Jane Regulator',
        recyclingOperationsUpdatedAt: '2026-05-01T10:00:00Z'
      },
      ID
    )
    expect(view.lastEdited.by).toBe('Jane Regulator')
    expect(view.lastEdited.at).toEqual(expect.any(String))
  })

  test('builds an edit href from the work item and site ids', () => {
    const view = buildRecyclingOperationsSite({ siteId: 'site-1' }, ID)
    expect(view.editHref).toBe(
      `/work-items/${ID}/recycling-operations/site-1/edit`
    )
  })

  test('null editHref when the site has no id', () => {
    const view = buildRecyclingOperationsSite({}, ID)
    expect(view.editHref).toBeNull()
  })
})

describe('readFlashBanner', () => {
  test('AC13: returns the first flashed banner, same shape as detail.controller.js', () => {
    const request = {
      yar: {
        flash: vi.fn().mockReturnValue([{ type: 'success', text: 'Saved' }])
      }
    }
    expect(readFlashBanner(request)).toEqual({ type: 'success', text: 'Saved' })
    expect(request.yar.flash).toHaveBeenCalledWith('flashBanner')
  })

  test('returns null when nothing was flashed', () => {
    const request = { yar: { flash: vi.fn().mockReturnValue([]) } }
    expect(readFlashBanner(request)).toBeNull()
  })

  test('returns null when yar is absent', () => {
    expect(readFlashBanner({})).toBeNull()
  })
})
