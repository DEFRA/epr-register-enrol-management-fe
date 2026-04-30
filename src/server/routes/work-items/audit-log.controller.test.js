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
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn()
}))

const { getWorkItem } = await import(
  '#/server/common/helpers/backend-api/backend-api.js'
)

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
    tasks: [],
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

describe('#workItemAuditLogController', () => {
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

  test('Renders the audit log page with entries in chronological (oldest-first) order, action, actor and timestamp', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        auditLog: [
          {
            id: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            action: 'task-completed',
            actionDisplayName: 'Task completed',
            details: {
              taskId: 'check-eligibility',
              taskDisplayName: 'Check eligibility'
            },
            createdAt: '2026-04-27T09:00:00Z',
            createdBy: 'alice-1',
            createdByName: 'Alice Example'
          },
          {
            id: 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            action: 'action-applied',
            actionDisplayName: 'Action applied',
            details: {
              actionId: 'approve',
              actionDisplayName: 'Approve',
              fromStateId: 'submitted',
              toStateId: 'approved'
            },
            createdAt: '2026-04-27T10:00:00Z',
            createdBy: 'bob-2',
            createdByName: 'Bob Example'
          }
        ]
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/audit-log`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkItem).toHaveBeenCalledWith({
      workItemId: ID,
      user: expect.objectContaining({ id: expect.any(String) })
    })
    expect(result).toEqual(expect.stringContaining('Audit log'))
    expect(result).toEqual(expect.stringContaining('Task completed'))
    expect(result).toEqual(expect.stringContaining('Check eligibility'))
    expect(result).toEqual(expect.stringContaining('Action applied'))
    expect(result).toEqual(
      expect.stringContaining('Approve (submitted → approved)')
    )
    expect(result).toEqual(expect.stringContaining('Alice Example'))
    expect(result).toEqual(expect.stringContaining('Bob Example'))
    expect(result).toEqual(expect.stringContaining('2026-04-27T09:00:00Z'))
    // Chronological (oldest-first) ordering: the earlier entry appears
    // before the later one in the rendered HTML.
    expect(result.indexOf('Task completed')).toBeLessThan(
      result.indexOf('Action applied')
    )
    // Provides a way back to the detail page.
    expect(result).toEqual(expect.stringContaining(`/work-items/${ID}`))
  })

  test('Renders an empty audit log message when no entries exist', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ auditLog: [] })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/audit-log`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining(
        'No actions have been recorded against this work item yet.'
      )
    )
  })

  test('Renders 404 page when the backend reports no such work item', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/audit-log`
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Work item not found'))
  })

  test('Renders 502 page when the backend cannot be reached', async () => {
    getWorkItem.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/audit-log`
    })

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(result).toEqual(expect.stringContaining('Work item unavailable'))
    expect(result).toEqual(expect.stringContaining('ECONNREFUSED'))
  })
})
