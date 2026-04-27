import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getBackendHealth: vi.fn(),
  getWorkItems: vi.fn()
}))

const { getWorkItems } = await import(
  '#/server/common/helpers/backend-api/backend-api.js'
)

describe('#workItemListController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItems.mockReset()
    // The plugin clears the registry on each createServer registration; tests
    // that need a known type must register it after server boot.
  })

  test('Renders the empty state when the backend has no items', async () => {
    getWorkItems.mockResolvedValue({ ok: true, items: [] })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Work items |'))
    expect(result).toEqual(
      expect.stringContaining('No work items have been submitted yet.')
    )
  })

  test('Renders submitted items in a table with type and state display names', async () => {
    clearWorkItemRegistry()
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

    getWorkItems.mockResolvedValue({
      ok: true,
      items: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          typeId: 're-accreditation',
          stateId: 'submitted',
          submittedAt: '2026-04-27T10:00:00Z',
          submittedBy: 'frontend',
          payload: {}
        }
      ]
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('11111111-1111-1111-1111-111111111111'))
    expect(result).toEqual(expect.stringContaining('Re-accreditation'))
    expect(result).toEqual(expect.stringContaining('Submitted'))
    expect(result).toEqual(expect.stringContaining('frontend'))
  })

  test('Falls back to raw type id when no module is registered for the type', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue({
      ok: true,
      items: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          typeId: 'unknown-type',
          stateId: 'mystery',
          submittedAt: '2026-04-27T10:00:00Z',
          submittedBy: null,
          payload: {}
        }
      ]
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('unknown-type'))
    expect(result).toEqual(expect.stringContaining('mystery'))
    // Empty submitter renders as an em-dash.
    expect(result).toEqual(expect.stringContaining('—'))
  })

  test('Renders an error banner when the backend cannot be reached', async () => {
    getWorkItems.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Could not reach the backend'))
    expect(result).toEqual(expect.stringContaining('ECONNREFUSED'))
  })
})
