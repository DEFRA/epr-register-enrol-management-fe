import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getBackendHealth: vi.fn()
}))

const { getBackendHealth } = await import(
  '#/server/common/helpers/backend-api/backend-api.js'
)

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
      url: '/backend-status'
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
      url: '/backend-status'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Unreachable'))
    expect(result).toEqual(expect.stringContaining('ECONNREFUSED'))
  })
})
