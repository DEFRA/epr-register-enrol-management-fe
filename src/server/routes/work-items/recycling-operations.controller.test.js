import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import {
  buildRecyclingOperationsSite,
  filterRecyclingOperationsSites,
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

/** N sites named Site 01, Site 02, ... so alphabetical order == numeric order. */
function manySites(count) {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    return anOrsSite({
      siteId: `site-${n}`,
      siteName: `Site ${n}`,
      operationCodes: ['R3']
    })
  })
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

  // RA-486: R12/R13 are no longer coupled to an interim site — the ORS's own
  // codes and the interim site's existence are now independent, so the
  // interim-site line is shown whenever the ORS HAS an associated interim
  // site, regardless of which codes the ORS itself carries.
  test('RA-486: shows the associated interim site even when only R3/R4/R5 are set', async () => {
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
                interimSite: { siteName: 'Should Render' }
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

    expect(result).toContain('Should Render')
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
      /<a[^>]*href="\/work-items\/[^"]+\/recycling-operations\/site-1"[^>]*data-testid="recycling-operations-site-change-site-1"/
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

  // RA-486: showing the interim site is now keyed purely on its presence,
  // not on the ORS's own codes.
  test('RA-486: shows the interim site when present, regardless of the ORS codes', () => {
    const view = buildRecyclingOperationsSite(
      {
        siteId: 's1',
        operationCodes: ['R5'],
        interimSite: { siteName: 'Interim Depot' }
      },
      ID
    )
    expect(view.interimSite).toEqual({
      siteName: 'Interim Depot',
      addressLine: null
    })
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
    expect(view.editHref).toBe(`/work-items/${ID}/recycling-operations/site-1`)
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

describe('filterRecyclingOperationsSites', () => {
  const sites = [
    { siteName: 'Alpha Reprocessing' },
    { siteName: 'Bravo Site' },
    { siteName: 'alphabet City Recycling' }
  ]

  test('AC4: case-insensitive substring match on site name', () => {
    expect(filterRecyclingOperationsSites(sites, 'alpha')).toEqual([
      { siteName: 'Alpha Reprocessing' },
      { siteName: 'alphabet City Recycling' }
    ])
  })

  test('an empty search term matches every site', () => {
    expect(filterRecyclingOperationsSites(sites, '')).toEqual(sites)
    expect(filterRecyclingOperationsSites(sites, undefined)).toEqual(sites)
  })

  test('a term matching nothing returns an empty array', () => {
    expect(filterRecyclingOperationsSites(sites, 'zzz')).toEqual([])
  })
})

describe('#workItemRecyclingOperationsController search and pagination (RA-469 8hy)', () => {
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

  test('AC3: search box is absent at exactly 20 sites', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: manySites(20) }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(result).not.toContain('recycling-operations-search-form')
  })

  test('AC3: search box is present at 21 sites', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: manySites(21) }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(result).toContain('recycling-operations-search-form')
    expect(result).toContain('Find a site by name')
    // AC4: a plain GET, full page reload — no client-side JavaScript, and
    // no method="post" that would need a CSRF crumb.
    expect(result).toMatch(
      /<form method="get" action="\/work-items\/[^"]+\/recycling-operations"[^>]*data-testid="recycling-operations-search-form"/
    )
  })

  test('AC5: pagination is absent when the result set is exactly 20', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: manySites(20) }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(result).not.toContain('govuk-pagination')
  })

  test('AC5: pagination is present and correct when the result set exceeds 20', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: manySites(21) }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations`
    })

    expect(result).toContain('govuk-pagination')
    // Page 1 shows the first 20 (Site 01..Site 20), not Site 21.
    expect(result).toContain('Site 01')
    expect(result).toContain('Site 20')
    expect(result).not.toContain('Site 21')
  })

  test('?page=2 shows the remaining site', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: manySites(21) }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations?page=2`
    })

    expect(result).toContain('Site 21')
    expect(result).not.toContain('Site 01')
  })

  test('AC4: q= filters case-insensitively by substring across the full site list', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [
              anOrsSite({ siteId: 's1', siteName: 'Newport Reprocessing' }),
              anOrsSite({ siteId: 's2', siteName: 'Cardiff Recycling' })
            ]
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations?q=NEWPORT`
    })

    expect(result).toContain('Newport Reprocessing')
    expect(result).not.toContain('Cardiff Recycling')
  })

  test('a search matching nothing shows a distinct "no results" message', async () => {
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
      url: `/work-items/${ID}/recycling-operations?q=doesnotexist`
    })

    expect(result).toContain('recycling-operations-no-search-results')
    expect(result).not.toContain('recycling-operations-no-sites')
  })

  test('page links carry q= forward; the page-1 link omits page=', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          // 25 sites all matching "Site" so filtering still leaves >20.
          overseasSites: { sites: manySites(25) }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations?q=Site&page=2`
    })

    // The "previous" link (back to page 1) must carry q= but omit page=.
    expect(result).toMatch(
      /href="\/work-items\/[^"]+\/recycling-operations\?q=Site"/
    )
    // Page 2's own link carries both q= and page=2 (HTML-escaped &amp;).
    expect(result).toContain(
      `/work-items/${ID}/recycling-operations?q=Site&amp;page=2`
    )
  })

  test('an out-of-range page number defaults to page 1 rather than erroring', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: manySites(21) }
        }
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations?page=999`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('Site 01')
  })
})
