import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  applyWorkItemAction: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn()
}))

const { getWorkItems } = await import(
  '#/server/common/helpers/backend-api/backend-api.js'
)

function emptyPage(overrides = {}) {
  return {
    ok: true,
    items: [],
    totalCount: 0,
    page: 1,
    pageSize: 20,
    ...overrides
  }
}

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
    getWorkItems.mockResolvedValue(emptyPage())

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

    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: 'frontend',
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('11111111-1111-1111-1111-111111111111')
    )
    expect(result).toEqual(expect.stringContaining('Re-accreditation'))
    expect(result).toEqual(expect.stringContaining('Submitted'))
    expect(result).toEqual(expect.stringContaining('frontend'))
  })

  test('Falls back to raw type id when no module is registered for the type', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            typeId: 'unknown-type',
            stateId: 'mystery',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

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
    expect(result).toEqual(
      expect.stringContaining('Could not reach the backend')
    )
    expect(result).toEqual(expect.stringContaining('ECONNREFUSED'))
  })

  test('Forwards type, state, search and page filters to the backend', async () => {
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
    registerWorkItemType({
      id: 'other',
      displayName: 'Other',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(
      emptyPage({ totalCount: 0, page: 2, pageSize: 20 })
    )

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items?typeId=re-accreditation&typeId=other&stateId=approved&search=acme&page=2'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        typeIds: ['re-accreditation', 'other'],
        stateIds: ['approved'],
        search: 'acme',
        page: 2,
        pageSize: 20
      })
    )
  })

  test('Drops unknown type and state filter values', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?typeId=ghost&stateId=mystery&search=&page=0'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        typeIds: [],
        stateIds: [],
        search: '',
        page: 1,
        pageSize: 20
      })
    )
  })

  test('Renders a pagination block when there is more than one page', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 45,
        page: 2,
        pageSize: 20
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items?page=2'
    })

    // govuk-pagination renders a <nav class="govuk-pagination">.
    expect(result).toEqual(expect.stringContaining('govuk-pagination'))
    // Previous and next links preserve the page parameter.
    expect(result).toEqual(expect.stringContaining('href="/work-items"'))
    expect(result).toEqual(expect.stringContaining('href="/work-items?page=3"'))
    expect(result).toEqual(
      expect.stringContaining(
        'Showing page <strong>2</strong> of <strong>3</strong>'
      )
    )
  })

  test('Shows a filtered empty-state message when filters are active but nothing matches', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(emptyPage())

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items?typeId=re-accreditation'
    })

    expect(result).toEqual(
      expect.stringContaining('No work items match your filters.')
    )
    expect(result).toEqual(expect.stringContaining('Clear filters'))
  })

  test('Translates assigneeMode=mine into the signed-in user id', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=mine'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        // Default test user is the assign-role stub user.
        assigneeId: 'test-assign-id',
        unassigned: false
      })
    )
  })

  test('Translates assigneeMode=unassigned into unassigned=true', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=unassigned'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: null, unassigned: true })
    )
  })

  test('Translates assigneeMode=user with assigneeUserId into a backend assigneeId filter', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=user&assigneeUserId=u-9'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: 'u-9', unassigned: false })
    )
  })

  test('Drops unknown assigneeMode values silently', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=ghost'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: null, unassigned: false })
    )
  })

  test('Forwards the signed-in user to the backend client so identity headers are sent', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({ method: 'GET', url: '/work-items' })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: expect.any(String) })
      })
    )
  })
})
