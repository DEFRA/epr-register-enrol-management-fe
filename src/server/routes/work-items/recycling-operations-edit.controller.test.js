import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import {
  ACCOMPANYING_CODE_MESSAGE,
  INTERIM_SITE_REQUIRED_MESSAGE,
  SELECT_CODES_MESSAGE
} from './recycling-operations.schema.js'

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

const { getWorkItem, updateRecyclingOperations } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '11111111-1111-1111-1111-111111111111'
const SITE_ID = 'site-1'
const EDIT_HREF = `/work-items/${ID}/recycling-operations/${SITE_ID}`
const LIST_HREF = `/work-items/${ID}/recycling-operations`

function anOrsSite(overrides = {}) {
  return {
    siteId: SITE_ID,
    siteName: 'Zebra Reprocessing',
    operationCodes: ['R3'],
    ...overrides
  }
}

function aWorkItem(overrides = {}) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    payload: {
      applicationReference: 'RA-000000001',
      material: 'glass',
      overseasSites: { sites: [anOrsSite()] }
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

const urlencoded = { 'content-type': 'application/x-www-form-urlencoded' }

function postCodes(server, codes, url = EDIT_HREF) {
  const payload = codes.map((c) => `codes=${encodeURIComponent(c)}`).join('&')
  return injectWithCrumb(server, {
    method: 'POST',
    url,
    headers: urlencoded,
    payload
  })
}

describe('GET /work-items/{id}/recycling-operations/{siteId}', () => {
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

  test('AC9: pre-populates checkboxes with the site’s existing codes', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [anOrsSite({ operationCodes: ['R5', 'R12'] })]
          }
        }
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: EDIT_HREF
    })

    expect(statusCode).toBe(statusCodes.ok)
    // Glass offers R5/R12/R13 only.
    expect(result).toContain('value="R5"')
    expect(result).toContain('value="R12"')
    expect(result).toContain('value="R13"')
    expect(result).not.toContain('value="R3"')
    expect(result).not.toContain('value="R4"')
    expect(result).toMatch(
      /name="codes"\s+type="checkbox"\s+value="R5"\s+checked/
    )
    expect(result).toMatch(
      /name="codes"\s+type="checkbox"\s+value="R12"\s+checked/
    )
  })

  test('finds the site when payload.siteId is a real int, not just the fixture-shaped string', async () => {
    // epr-register-enrol-backend's OverseasSiteModel.SiteId is a C# int,
    // which round-trips through JSON as a number — the route param is
    // always a string, so a strict === on the raw value would 404 every
    // real site (this repo's own fixtures use string siteIds throughout,
    // which never exercised that mismatch).
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [anOrsSite({ siteId: 1, operationCodes: ['R5'] })]
          }
        }
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/recycling-operations/1`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toMatch(
      /name="codes"\s+type="checkbox"\s+value="R5"\s+checked/
    )
  })

  test('offers all five codes for a material with no restriction (unrecognised token)', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'not-a-real-material',
          overseasSites: { sites: [anOrsSite({ operationCodes: [] })] }
        }
      })
    })

    const { result } = await server.inject({ method: 'GET', url: EDIT_HREF })

    for (const code of ['R3', 'R4', 'R5', 'R12', 'R13']) {
      expect(result).toContain(`value="${code}"`)
    }
  })

  test('returns 404 when the site does not exist on the work item', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: [] }
        }
      })
    })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: EDIT_HREF
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('returns 404 when the work item does not exist', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: EDIT_HREF
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })

  // RA-323: GET routes only require an authenticated session — the POST
  // route below is what actually enforces requireStandard (AC14/RA-335).
  // A support-readonly session can still open the form to review the
  // current selection; its Save button is disabled by user.isReadOnly and
  // the POST route rejects a crafted submission regardless.
  test('a support-readonly session can still view the form (only POST is gated)', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: EDIT_HREF,
      headers: { 'x-test-user-role': 'support-readonly' }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('disabled')
  })
})

describe('POST /work-items/{id}/recycling-operations/{siteId}', () => {
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
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    updateRecyclingOperations.mockReset()
    clearWorkItemRegistry()
    registerReaccreditation()
  })

  test('AC13: valid submission updates the codes and redirects to the list with a success banner', async () => {
    updateRecyclingOperations.mockResolvedValue({
      ok: true,
      workItem: aWorkItem()
    })

    const post = await postCodes(server, ['R5'])

    expect(post.statusCode).toBe(statusCodes.redirect)
    expect(post.headers.location).toBe(LIST_HREF)
    expect(updateRecyclingOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        siteId: SITE_ID,
        operationCodes: ['R5']
      })
    )

    const session = [].concat(post.headers['set-cookie'] ?? []).join('; ')
    const list = await server.inject({
      method: 'GET',
      url: LIST_HREF,
      headers: { cookie: session }
    })

    expect(list.result).toContain('Recycling operations updated')
  })

  test('AC10: R12 alone re-renders the form with the exact operator-journey error message', async () => {
    const { statusCode, result } = await postCodes(server, ['R12'])

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain(ACCOMPANYING_CODE_MESSAGE)
    expect(updateRecyclingOperations).not.toHaveBeenCalled()
  })

  test('AC11: R12 on a site with no interim site re-renders with a distinct clear error', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [anOrsSite({ operationCodes: [], interimSite: null })]
          }
        }
      })
    })

    const { statusCode, result } = await postCodes(server, ['R5', 'R12'])

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain(INTERIM_SITE_REQUIRED_MESSAGE)
    expect(updateRecyclingOperations).not.toHaveBeenCalled()
  })

  test('accepts R12 when the site has an associated interim site', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: {
            sites: [
              anOrsSite({
                operationCodes: [],
                interimSite: { siteName: 'Interim Depot' }
              })
            ]
          }
        }
      })
    })
    updateRecyclingOperations.mockResolvedValue({
      ok: true,
      workItem: aWorkItem()
    })

    const { statusCode } = await postCodes(server, ['R5', 'R12'])

    expect(statusCode).toBe(statusCodes.redirect)
    expect(updateRecyclingOperations).toHaveBeenCalledWith(
      expect.objectContaining({ operationCodes: ['R5', 'R12'] })
    )
  })

  test('AC12: zero codes re-renders with "Select at least one recycling operation"', async () => {
    const { statusCode, result } = await postCodes(server, [])

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain(SELECT_CODES_MESSAGE)
    expect(updateRecyclingOperations).not.toHaveBeenCalled()
  })

  test('rejects a code outside the material-type applicable set', async () => {
    // aWorkItem() defaults to material: 'glass' -> R5/R12/R13 only.
    const { statusCode, result } = await postCodes(server, ['R3'])

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain(SELECT_CODES_MESSAGE)
  })

  test('AC14: a 403 from the backend redirects with a clear not-authorized banner, not a 500', async () => {
    updateRecyclingOperations.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      status: 403,
      message: 'Forbidden'
    })

    const post = await postCodes(server, ['R5'])

    expect(post.statusCode).toBe(statusCodes.redirect)
    expect(post.headers.location).toBe(LIST_HREF)

    const session = [].concat(post.headers['set-cookie'] ?? []).join('; ')
    const list = await server.inject({
      method: 'GET',
      url: LIST_HREF,
      headers: { cookie: session }
    })

    expect(list.result).toContain(
      'You do not have permission to update this site.'
    )
  })

  test('redirects with an error banner on a network failure', async () => {
    updateRecyclingOperations.mockResolvedValue({
      ok: false,
      reason: 'network',
      message: 'Request timed out'
    })

    const post = await postCodes(server, ['R5'])
    expect(post.statusCode).toBe(statusCodes.redirect)

    const session = [].concat(post.headers['set-cookie'] ?? []).join('; ')
    const list = await server.inject({
      method: 'GET',
      url: LIST_HREF,
      headers: { cookie: session }
    })

    expect(list.result).toContain(
      'There was a problem updating the recycling operations'
    )
  })

  test('returns 404 when the site does not exist', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          material: 'glass',
          overseasSites: { sites: [] }
        }
      })
    })

    const { statusCode } = await postCodes(server, ['R5'])

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('a support-readonly session is rejected server-side (requireStandard)', async () => {
    const { statusCode } = await injectWithCrumb(server, {
      method: 'POST',
      url: EDIT_HREF,
      headers: { ...urlencoded, 'x-test-user-role': 'support-readonly' },
      payload: 'codes=R5'
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(updateRecyclingOperations).not.toHaveBeenCalled()
  })
})
