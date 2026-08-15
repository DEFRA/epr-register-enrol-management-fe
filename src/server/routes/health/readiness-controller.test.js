import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

vi.mock('./required-config.js', () => ({
  findMissingRequiredConfig: vi.fn()
}))

const { findMissingRequiredConfig } = await import('./required-config.js')

describe('#readinessController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('returns 200 Healthy when nothing is missing', async () => {
    findMissingRequiredConfig.mockReturnValue([])

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/health/ready'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual({ status: 'Healthy', checks: [] })
  })

  test('returns 503 Unhealthy naming the missing keys when something is missing', async () => {
    findMissingRequiredConfig.mockReturnValue([
      'BACKEND_API_URL',
      'ENTRA_TENANT_ID'
    ])

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/health/ready'
    })

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(result.status).toBe('Unhealthy')
    expect(result.checks[0].description).toContain('BACKEND_API_URL')
    expect(result.checks[0].description).toContain('ENTRA_TENANT_ID')
  })
})
