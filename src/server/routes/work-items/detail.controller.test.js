import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import {
  clearDetailTemplateRegistry,
  registerDetailTemplate
} from '#/server/work-items/core/templates.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  applyWorkItemAction: vi.fn()
}))

const {
  getWorkItem,
  getWorkItems,
  completeWorkItemTask,
  applyWorkItemAction,
  assignWorkItem,
  unassignWorkItem
} = await import('#/server/common/helpers/backend-api/backend-api.js')

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
    payload: { applicantName: 'Acme' },
    tasks: [
      { taskId: 'check-eligibility', displayName: 'Check eligibility', isComplete: false }
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

describe('#workItemDetailController', () => {
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
    getWorkItems.mockReset()
    completeWorkItemTask.mockReset()
    applyWorkItemAction.mockReset()
    assignWorkItem.mockReset()
    unassignWorkItem.mockReset()
    clearWorkItemRegistry()
    clearDetailTemplateRegistry()
  })

  test('Renders the work item with summary, tasks and payload', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkItem).toHaveBeenCalledWith({
      workItemId: ID,
      user: expect.objectContaining({ id: expect.any(String) })
    })
    expect(result).toEqual(expect.stringContaining(`Work item ${ID}`))
    expect(result).toEqual(expect.stringContaining('Re-accreditation'))
    expect(result).toEqual(expect.stringContaining('Submitted'))
    expect(result).toEqual(expect.stringContaining('Check eligibility'))
    expect(result).toEqual(expect.stringContaining('Mark complete'))
    expect(result).toEqual(expect.stringContaining('Acme'))
    expect(result).toEqual(expect.stringContaining('v1'))
  })

  test('Renders task as complete (no mark-complete button) when task isComplete', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        tasks: [
          { taskId: 'check-eligibility', displayName: 'Check eligibility', isComplete: true }
        ],
        availableActions: [
          { actionId: 'approve', displayName: 'Approve', fromStateId: 'submitted', toStateId: 'approved', requiresAllTasksComplete: true }
        ]
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Complete'))
    expect(result).not.toEqual(expect.stringContaining('Mark complete'))
    expect(result).toEqual(expect.stringContaining('Approve'))
    expect(result).toEqual(
      expect.stringContaining(`/work-items/${ID}/actions/approve`)
    )
  })

  test('Picks the module-registered template for the matching version', async () => {
    registerReaccreditation()
    // Register two templates; the work item's templateVersion picks v2.
    registerDetailTemplate(
      're-accreditation',
      'v1',
      'work-items/detail' // generic
    )
    registerDetailTemplate(
      're-accreditation',
      'v2',
      'work-items/detail' // shipping a different template would point elsewhere
    )

    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ templateVersion: 'v2' })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    // Template version is surfaced in the summary list.
    expect(result).toEqual(expect.stringContaining('v2'))
  })

  test('Renders 404 page when the backend reports no such work item', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Work item not found'))
    expect(result).toEqual(expect.stringContaining(ID))
  })

  test('Renders 502 page when the backend cannot be reached', async () => {
    getWorkItem.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(result).toEqual(expect.stringContaining('Work item unavailable'))
    expect(result).toEqual(expect.stringContaining('ECONNREFUSED'))
  })

  test('POST complete-task redirects to the detail page on success', async () => {
    completeWorkItemTask.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        tasks: [{ taskId: 'check-eligibility', displayName: 'Check eligibility', isComplete: true }]
      })
    })

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/tasks/check-eligibility/complete`
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(completeWorkItemTask).toHaveBeenCalledWith({
      workItemId: ID,
      taskId: 'check-eligibility',
      user: expect.objectContaining({ id: expect.any(String) })
    })
  })

  test('POST complete-task re-renders detail with engine error inline', async () => {
    registerReaccreditation()
    completeWorkItemTask.mockResolvedValue({
      ok: false,
      status: 400,
      problem: { detail: 'Task "x" is not required' }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/tasks/x/complete`
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('Could not'))
    expect(result).toEqual(expect.stringContaining('is not required'))
  })

  test('POST action redirects to the detail page on success', async () => {
    applyWorkItemAction.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ stateId: 'approved' })
    })

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/actions/approve`
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
  })

  test('POST action surfaces 409 when engine refuses (incomplete tasks)', async () => {
    registerReaccreditation()
    applyWorkItemAction.mockResolvedValue({
      ok: false,
      status: 409,
      problem: { detail: 'Tasks outstanding' }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/actions/approve`
    })

    expect(statusCode).toBe(statusCodes.conflict)
    expect(result).toEqual(expect.stringContaining('Tasks outstanding'))
  })

  test('POST assign forwards the assignee id and a directory-resolved name to the API', async () => {
    registerReaccreditation()
    assignWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        assignedToId: 'stub-standard-1',
        assignedToName: 'Stub Standard User'
      })
    })

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/assign`,
      payload: 'assigneeId=stub-standard-1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(assignWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        assigneeId: 'stub-standard-1',
        // The controller resolves the snapshot name from the assignable
        // users directory (stub-auth users) so the backend gets a
        // canonical name even when the form omitted it.
        assigneeName: 'Stub Standard User',
        user: expect.objectContaining({ id: expect.any(String) })
      })
    )
  })

  test('POST assign with empty assigneeId re-renders detail with an inline error', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/assign`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(
      expect.stringContaining('Choose a user to assign this work item to.')
    )
    expect(assignWorkItem).not.toHaveBeenCalled()
  })

  test('POST assign surfaces a backend 403 as inline not-authorized error', async () => {
    registerReaccreditation()
    assignWorkItem.mockResolvedValue({
      ok: false,
      status: 403,
      problem: { detail: 'Standard users can only self-assign' }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/assign`,
      payload: 'assigneeId=stub-standard-1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(result).toEqual(
      expect.stringContaining('Standard users can only self-assign')
    )
  })

  test('POST unassign clears the assignment and redirects', async () => {
    registerReaccreditation()
    unassignWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ assignedToId: null, assignedToName: null })
    })

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: `/work-items/${ID}/unassign`
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(unassignWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        user: expect.objectContaining({ id: expect.any(String) })
      })
    )
  })
})
