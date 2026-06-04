import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'

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

const { getWorkItem, addWorkItemTaskNote } =
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
    payload: {},
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
    notes: [
      {
        id: 'n-1',
        text: 'work-item level note',
        createdAt: '2026-04-27T11:00:00Z',
        createdBy: 'u-1',
        createdByName: 'Alice',
        taskId: null
      },
      {
        id: 'n-2',
        text: 'eligibility note',
        createdAt: '2026-04-27T11:30:00Z',
        createdBy: 'u-2',
        createdByName: 'Bob',
        taskId: 'check-eligibility'
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
    addWorkItemTaskNote.mockReset()
    clearWorkItemRegistry()
  })

  describe('GET /work-items/{id}/tasks', () => {
    test('renders the tasks page grouped by status with notes split', async () => {
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
      // Work-item-level note rendered separately.
      expect(result).toEqual(expect.stringContaining('work-item level note'))
      // Task-scoped note rendered inline against its task.
      expect(result).toEqual(expect.stringContaining('eligibility note'))
      // Action targets present.
      expect(result).toEqual(
        expect.stringContaining(
          `/work-items/${ID}/tasks/check-eligibility/notes`
        )
      )
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

    test('handles a work item with no tasks and no notes', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ tasks: [], notes: [] })
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

    test('handles missing tasks/notes arrays defensively', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ tasks: undefined, notes: undefined })
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
          ],
          notes: []
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

  describe('POST /work-items/{id}/tasks/{taskId}/notes', () => {
    test('redirects to the tasks page anchor on success', async () => {
      registerReaccreditation()
      addWorkItemTaskNote.mockResolvedValue({
        ok: true,
        workItem: aWorkItem()
      })

      const { statusCode, headers } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/tasks/check-eligibility/notes`,
        payload: { text: 'a fresh note' }
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(
        `/work-items/${ID}/tasks#task-check-eligibility`
      )
      expect(addWorkItemTaskNote).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ID,
          taskId: 'check-eligibility',
          text: 'a fresh note'
        })
      )
    })

    test('re-renders the page with a 400 notice when the text is blank', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

      const { statusCode, result } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/tasks/check-eligibility/notes`,
        payload: { text: '   ' }
      })

      expect(addWorkItemTaskNote).not.toHaveBeenCalled()
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toEqual(
        expect.stringContaining('Could not add note to task')
      )
      expect(result).toEqual(expect.stringContaining('Note text is required.'))
    })

    test('re-renders with 409 when the backend rejects with not-allowed', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
      addWorkItemTaskNote.mockResolvedValue({
        ok: false,
        status: 409,
        problem: { detail: 'Concurrent update' }
      })

      const { statusCode, result } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/tasks/check-eligibility/notes`,
        payload: { text: 'good text' }
      })

      expect(statusCode).toBe(statusCodes.conflict)
      expect(result).toEqual(expect.stringContaining('Concurrent update'))
    })

    test('re-renders with 403 when the backend rejects with not-authorized', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
      addWorkItemTaskNote.mockResolvedValue({
        ok: false,
        status: 403,
        problem: { detail: 'Forbidden' }
      })

      const { statusCode, result } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/tasks/check-eligibility/notes`,
        payload: { text: 'good text' }
      })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(result).toEqual(expect.stringContaining('Forbidden'))
    })

    test('uses fallback message when the service returns no message', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
      // 500 maps to reason='backend-error' with default message; controller
      // hits the else (statusCode=400) branch.
      addWorkItemTaskNote.mockResolvedValue({ ok: false, status: 500 })

      const { statusCode } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/tasks/check-eligibility/notes`,
        payload: { text: 'good text' }
      })

      expect(statusCode).toBe(statusCodes.badRequest)
    })

    test('coerces a missing text payload to empty and re-renders', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

      const { statusCode } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/tasks/check-eligibility/notes`,
        payload: {}
      })

      expect(addWorkItemTaskNote).not.toHaveBeenCalled()
      expect(statusCode).toBe(statusCodes.badRequest)
    })
  })

  describe('makeAddTaskNoteController() defensive fallbacks', () => {
    test('falls back to {} when request.payload is null and to "Action failed" when service returns no message', async () => {
      const { makeAddTaskNoteController } =
        await import('./tasks.controller.js')
      const stubService = {
        addTaskNote: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'invalid'
          // no message
        })
      }
      const controller = makeAddTaskNoteController({ service: stubService })

      const captured = {}
      const h = {
        view: (view, context) => {
          captured.view = view
          captured.context = context
          return {
            code: (statusCode) => {
              captured.statusCode = statusCode
              return 'rendered'
            }
          }
        },
        redirect: () => {
          throw new Error('should not redirect on failure')
        }
      }

      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

      const response = await controller.handler(
        {
          params: { id: ID, taskId: 'check-eligibility' },
          payload: null,
          state: {},
          auth: { credentials: { user: { id: 'u-1', name: 'A' } } }
        },
        h
      )

      expect(response).toBe('rendered')
      expect(stubService.addTaskNote).toHaveBeenCalledWith(
        expect.objectContaining({ text: '' })
      )
      expect(captured.statusCode).toBe(400)
      expect(captured.context.notice).toEqual(
        expect.objectContaining({ message: 'Action failed' })
      )
      clearWorkItemRegistry()
    })
  })
})
