import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  getBackendHealth: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  addWorkItemNote: vi.fn()
}))

const { getBackendHealth } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

// RA-335: /backend-status is restricted to a signed-in support user
// (`requireSupportReadonly`) — the test-bypass scheme auto-authenticates as
// the standard caseworker unless `x-test-user-role` says otherwise.
const SUPPORT_USER_HEADERS = { 'x-test-user-role': 'support-readonly' }

describe('#backendStatusController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getBackendHealth.mockReset()
  })

  test('Renders a reachable badge when the backend responds OK', async () => {
    getBackendHealth.mockResolvedValue({
      ok: true,
      status: 200,
      body: 'Healthy'
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/backend-status',
      headers: SUPPORT_USER_HEADERS
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Backend status |'))
    expect(result).toEqual(expect.stringContaining('Reachable'))
    expect(result).toEqual(expect.stringContaining('Healthy'))
  })

  test('Renders an unreachable badge when the backend errors', async () => {
    getBackendHealth.mockResolvedValue({
      ok: false,
      error: 'ECONNREFUSED'
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/backend-status',
      headers: SUPPORT_USER_HEADERS
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Unreachable'))
    expect(result).toEqual(expect.stringContaining('ECONNREFUSED'))
  })

  test('rejects a caseworker (standard role) with 403', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/backend-status'
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })
})
