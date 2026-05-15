import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { getCrumbToken, injectWithCrumb } from '#/test-helpers/csrf.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  addWorkItemTaskNote: vi.fn()
}))

const { addWorkItemNote, getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '11111111-1111-1111-1111-111111111111'

describe('#csrfProtection', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    addWorkItemNote.mockReset()
    getWorkItem.mockReset()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: ID,
        typeId: 're-accreditation',
        stateId: 'submitted',
        submittedAt: '2026-04-27T10:00:00Z',
        lastModifiedAt: '2026-04-27T10:00:00Z',
        templateVersion: 'v1',
        payload: {},
        tasks: [],
        availableActions: []
      }
    })
  })

  test('A POST without a crumb is rejected with the generic GDS 403 page', async () => {
    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/notes`,
      payload: 'text=hello',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    // Generic GDS error page from `errors.js::catchAll` — never a stack
    // trace.
    expect(result).toEqual(expect.stringContaining('Forbidden'))
    expect(result).not.toEqual(expect.stringContaining('at '))
    expect(addWorkItemNote).not.toHaveBeenCalled()
  })

  test('A POST with a valid crumb passes validation and reaches the handler', async () => {
    addWorkItemNote.mockResolvedValue({
      ok: true,
      workItem: { id: ID }
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/notes`,
      payload: 'text=hello',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}#notes`)
    expect(addWorkItemNote).toHaveBeenCalledOnce()
  })

  test('A POST with a body crumb that does not match the cookie is rejected', async () => {
    const cookieToken = await getCrumbToken(server)

    const { statusCode } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/notes`,
      payload: `text=hello&crumb=${cookieToken}TAMPERED`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `crumb=${cookieToken}`
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('GET requests are issued a crumb cookie and the token is exposed in the view context', async () => {
    const { statusCode, headers, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)

    const setCookies = [].concat(headers['set-cookie'] ?? [])
    const crumbCookie = setCookies.find((c) => c.startsWith('crumb='))
    expect(crumbCookie).toBeDefined()
    expect(crumbCookie).toEqual(expect.stringContaining('HttpOnly'))
    expect(crumbCookie).toEqual(expect.stringContaining('SameSite=Lax'))

    const cookieToken = /crumb=([^;]+)/.exec(crumbCookie)[1]

    // The same token is rendered into the form's hidden `crumb` input.
    expect(result).toEqual(
      expect.stringContaining(`name="crumb" value="${cookieToken}"`)
    )
  })

  test('The /health probe is excluded from crumb generation', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/health'
    })

    expect(statusCode).toBe(statusCodes.ok)
    const setCookies = [].concat(headers['set-cookie'] ?? [])
    expect(setCookies.some((c) => c.startsWith('crumb='))).toBe(false)
  })
})
