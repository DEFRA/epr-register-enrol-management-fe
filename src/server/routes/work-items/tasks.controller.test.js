import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn()
}))

const { getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '11111111-1111-1111-1111-111111111111'

function aWorkItem(overrides = {}) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    submittedAt: '2026-04-27T10:00:00Z',
    lastModifiedAt: '2026-04-27T10:05:00Z',
    submittedBy: 'frontend',
    templateVersion: 'v1',
    payload: { applicationReference: 'RA-000000001' },
    tasks: [
      {
        taskId: 'check-eligibility',
        displayName: 'Check eligibility',
        status: 'NotStarted',
        isComplete: false
      },
      {
        taskId: 'review-payload',
        displayName: 'Review payload',
        status: 'Completed',
        isComplete: true
      }
    ],
    availableActions: [],
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

describe('#workItemTasksController (RA-129)', () => {
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

  describe('GET /work-items/{id}/tasks', () => {
    test('renders the tasks page grouped by status', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}/tasks`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(getWorkItem).toHaveBeenCalledWith({
        workItemId: ID,
        user: expect.objectContaining({ id: expect.any(String) })
      })
      // Heading + breadcrumb to summary.
      expect(result).toEqual(expect.stringContaining('Tasks'))
      expect(result).toEqual(expect.stringContaining(`/work-items/${ID}`))
      // Both status groups rendered.
      expect(result).toEqual(expect.stringContaining('Not started'))
      expect(result).toEqual(expect.stringContaining('Completed'))
      // Task display names rendered.
      expect(result).toEqual(expect.stringContaining('Check eligibility'))
      expect(result).toEqual(expect.stringContaining('Review payload'))
      // Action targets present.
      expect(result).toEqual(
        expect.stringContaining(
          `/work-items/${ID}/tasks/check-eligibility/status`
        )
      )
      expect(result).toEqual(
        expect.stringContaining(
          `/work-items/${ID}/tasks/check-eligibility/complete`
        )
      )
    })

    // RA-196: caption and breadcrumb show the application reference when
    // present; routes keep using the internal id.
    test('shows the application reference in the caption, keeping the id in routes', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          payload: { applicationReference: 'RA-222333444' }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}/tasks`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('Work item RA-222333444'))
      expect(result).not.toEqual(expect.stringContaining(`Work item ${ID}`))
      expect(result).toEqual(expect.stringContaining(`/work-items/${ID}`))
    })

    test('handles a work item with no tasks', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ tasks: [] })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}/tasks`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('Tasks'))
    })

    test('falls back to the type id when the type is not registered', async () => {
      // No registerReaccreditation() — exercise the typeDisplayName fallback.
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}/tasks`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('re-accreditation'))
    })

    test('renders the not-found view when the backend returns 404', async () => {
      getWorkItem.mockResolvedValue({ ok: false, status: 404 })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}/tasks`
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toEqual(expect.stringContaining('Work item not found'))
    })

    test('renders the unavailable view when the backend errors', async () => {
      getWorkItem.mockResolvedValue({
        ok: false,
        status: 503,
        error: 'backend down'
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}/tasks`
      })

      expect(statusCode).toBe(statusCodes.badGateway)
      expect(result).toEqual(expect.stringContaining('Work item unavailable'))
      expect(result).toEqual(expect.stringContaining('backend down'))
    })

    test('uses a generic error message when the backend gives no error string', async () => {
      getWorkItem.mockResolvedValue({ ok: false, status: 500 })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}/tasks`
      })

      expect(statusCode).toBe(statusCodes.badGateway)
      expect(result).toEqual(expect.stringContaining('Backend returned 500'))
    })

    test('handles a missing tasks array defensively', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ tasks: undefined })
      })

      const { statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}/tasks`
      })

      expect(statusCode).toBe(statusCodes.ok)
    })

    test('falls back to NotStarted/Completed for tasks without a status field', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          tasks: [
            { taskId: 't-a', displayName: 'A', isComplete: false },
            { taskId: 't-b', displayName: 'B', isComplete: true }
          ]
        })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}/tasks`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('Not started'))
      expect(result).toEqual(expect.stringContaining('Completed'))
    })
  })
})
