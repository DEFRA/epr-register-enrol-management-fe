import { afterEach, describe, expect, test, vi } from 'vitest'

import { config } from '#/config/config.js'
import {
  addWorkItemNote,
  applyWorkItemAction,
  approveReAccreditation,
  assertSafeHeaderValue,
  assignWorkItem,
  completeWorkItemTask,
  createWorkItem,
  extendWorkItemSla,
  getBackendHealth,
  getWorkItem,
  getWorkItems,
  overrideWorkItemSla,
  setWorkItemTaskStatus,
  unassignWorkItem
} from './backend-api.js'

describe('#getBackendHealth', () => {
  test('Returns ok=true with status and body when backend responds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('Healthy\n')
    })

    const result = await getBackendHealth({
      baseUrl: 'http://backend:8085/',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(result).toEqual({ ok: true, status: 200, body: 'Healthy' })
  })

  test('Returns ok=false with error message when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await getBackendHealth({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' })
  })

  test('Returns ok=false with timeout message when request aborts', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const fetchImpl = vi.fn().mockRejectedValue(abortError)

    const result = await getBackendHealth({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1,
      fetchImpl
    })

    expect(result).toEqual({ ok: false, error: 'Request timed out' })
  })

  test('Returns ok=false with status when backend responds with error status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Unhealthy')
    })

    const result = await getBackendHealth({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({ ok: false, status: 503, body: 'Unhealthy' })
  })
})

describe('#getWorkItems', () => {
  test('Returns ok=true with the parsed list when the backend responds', async () => {
    const items = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        typeId: 're-accreditation',
        stateId: 'submitted',
        submittedAt: '2026-04-27T10:00:00Z',
        submittedBy: 'frontend',
        payload: {}
      }
    ]
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items, totalCount: 1, page: 1, pageSize: 20 })
    })

    const result = await getWorkItems({
      baseUrl: 'http://backend:8085/',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          accept: 'application/json',
          'x-cdp-cognito-client-id': expect.any(String)
        })
      })
    )
    expect(result).toEqual({
      ok: true,
      items,
      totalCount: 1,
      page: 1,
      pageSize: 20
    })
  })

  test('Encodes filters, search and pagination as query string parameters', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], totalCount: 0, page: 2, pageSize: 5 })
    })

    await getWorkItems({
      typeIds: ['re-accreditation', 'other'],
      stateIds: ['submitted'],
      search: '  acme  ',
      page: 2,
      pageSize: 5,
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    const calledUrl = fetchImpl.mock.calls[0][0]
    expect(calledUrl).toContain('typeId=re-accreditation')
    expect(calledUrl).toContain('typeId=other')
    expect(calledUrl).toContain('stateId=submitted')
    expect(calledUrl).toContain('search=acme')
    expect(calledUrl).toContain('page=2')
    expect(calledUrl).toContain('pageSize=5')
  })

  test('Returns ok=false with status when the backend responds with an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({})
    })

    const result = await getWorkItems({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'Backend returned 503'
    })
  })

  test('Returns ok=false when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await getWorkItems({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' })
  })

  test('Returns ok=false with timeout error when request aborts', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const fetchImpl = vi.fn().mockRejectedValue(abortError)

    const result = await getWorkItems({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1,
      fetchImpl
    })

    expect(result).toEqual({ ok: false, error: 'Request timed out' })
  })

  test('Coerces non-array response bodies to an empty list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ unexpected: 'shape' })
    })

    const result = await getWorkItems({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: true,
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 0
    })
  })

  test('Appends multiple nation values as repeated query string params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 20 })
    })

    await getWorkItems({
      nations: ['England', 'Scotland'],
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    const calledUrl = fetchImpl.mock.calls[0][0]
    expect(calledUrl).toContain('nation=England')
    expect(calledUrl).toContain('nation=Scotland')
  })

  test('Omits the nation param when nations is empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 20 })
    })

    await getWorkItems({
      nations: [],
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    const calledUrl = fetchImpl.mock.calls[0][0]
    expect(calledUrl).not.toContain('nation=')
  })

  test('Appends includeArchived=true when includeArchived is true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 20 })
    })

    await getWorkItems({
      includeArchived: true,
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    const calledUrl = fetchImpl.mock.calls[0][0]
    expect(calledUrl).toContain('includeArchived=true')
  })

  test('Omits includeArchived param when includeArchived is false or absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 20 })
    })

    await getWorkItems({
      includeArchived: false,
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    const calledUrl = fetchImpl.mock.calls[0][0]
    expect(calledUrl).not.toContain('includeArchived')
  })
})

describe('#completeWorkItemTask', () => {
  test('POSTs to the engine endpoint and returns the updated work item', async () => {
    const workItem = {
      id: 'abc',
      stateId: 'submitted',
      tasks: [],
      availableActions: []
    }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await completeWorkItemTask({
      workItemId: 'abc',
      taskId: 'check-eligibility',
      baseUrl: 'http://backend:8085/',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/abc/tasks/check-eligibility/complete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ accept: 'application/json' })
      })
    )
    expect(result).toEqual({ ok: true, workItem })
  })

  test('Returns ok=false with the problem body on a 4xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          title: 'Invalid action',
          detail: 'Task not applicable'
        })
    })

    const result = await completeWorkItemTask({
      workItemId: 'abc',
      taskId: 'unknown',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.problem.detail).toBe('Task not applicable')
  })

  test('URL-encodes the task id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({})
    })

    await completeWorkItemTask({
      workItemId: 'abc',
      taskId: 'a/b c',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://backend:8085/work-items/abc/tasks/a%2Fb%20c/complete'
    )
  })
})

describe('#setWorkItemTaskStatus', () => {
  test('PUTs the status JSON body to the status endpoint', async () => {
    const workItem = { id: 'abc', stateId: 'submitted' }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await setWorkItemTaskStatus({
      workItemId: 'abc',
      taskId: 'check-eligibility',
      status: 'InProgress',
      baseUrl: 'http://backend:8085/',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/abc/tasks/check-eligibility/status',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ status: 'InProgress' }),
        headers: expect.objectContaining({
          accept: 'application/json',
          'content-type': 'application/json'
        })
      })
    )
    expect(result).toEqual({ ok: true, workItem })
  })

  test('Returns the problem body on a 400 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          title: 'Invalid status',
          detail: 'Unknown status value'
        })
    })

    const result = await setWorkItemTaskStatus({
      workItemId: 'abc',
      taskId: 'check-eligibility',
      status: 'bogus',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.problem.detail).toBe('Unknown status value')
  })
})

describe('#applyWorkItemAction', () => {
  test('POSTs to the action endpoint and returns the updated work item', async () => {
    const workItem = { id: 'abc', stateId: 'approved' }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await applyWorkItemAction({
      workItemId: 'abc',
      actionId: 'approve',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/abc/actions/approve',
      expect.objectContaining({ method: 'POST' })
    )
    expect(result).toEqual({ ok: true, workItem })
  })

  test('Returns ok=false with status when no JSON body is available', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json'))
    })

    const result = await applyWorkItemAction({
      workItemId: 'abc',
      actionId: 'approve',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({ ok: false, status: 500, problem: undefined })
  })

  test('Returns transport error when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await applyWorkItemAction({
      workItemId: 'abc',
      actionId: 'approve',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' })
  })
})

describe('#getWorkItem', () => {
  test('GETs the single-item endpoint and returns the work item', async () => {
    const workItem = {
      id: 'abc',
      typeId: 're-accreditation',
      stateId: 'submitted',
      templateVersion: 'v1',
      tasks: [],
      availableActions: []
    }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await getWorkItem({
      workItemId: 'abc',
      baseUrl: 'http://backend:8085/',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/abc',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          accept: 'application/json',
          'x-cdp-cognito-client-id': expect.any(String)
        })
      })
    )
    expect(result).toEqual({ ok: true, workItem })
  })

  test('Returns ok=false with status=404 when the work item does not exist', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({})
    })

    const result = await getWorkItem({
      workItemId: 'missing',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({ ok: false, status: 404 })
  })

  test('Returns ok=false with status and message on other 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({})
    })

    const result = await getWorkItem({
      workItemId: 'abc',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'Backend returned 503'
    })
  })

  test('Returns transport error when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await getWorkItem({
      workItemId: 'abc',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' })
  })

  test('URL-encodes the work item id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({})
    })

    await getWorkItem({
      workItemId: 'a/b c',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://backend:8085/work-items/a%2Fb%20c'
    )
  })
})

describe('#getWorkItems user identity headers', () => {
  test('Forwards x-cdp-user-id and name, but not roles, when a user is supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 20 })
    })

    await getWorkItems({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl,
      user: { id: 'u-1', name: 'Alice', roles: ['standard', 'assign'] }
    })

    const headers = fetchImpl.mock.calls[0][1].headers
    expect(headers['x-cdp-user-id']).toBe('u-1')
    expect(headers['x-cdp-user-name']).toBe('Alice')
    expect(headers['x-cdp-user-roles']).toBeUndefined()
  })

  test('Encodes assigneeId and unassigned filters into the query string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 20 })
    })

    await getWorkItems({
      assigneeId: 'u-9',
      unassigned: true,
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    const url = fetchImpl.mock.calls[0][0]
    expect(url).toContain('assigneeId=u-9')
    expect(url).toContain('unassigned=true')
  })
})

describe('#assignWorkItem', () => {
  test('POSTs the assignee body to the assign endpoint with user headers', async () => {
    const workItem = { id: 'abc', assignedToId: 'u-2', assignedToName: 'Bob' }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await assignWorkItem({
      workItemId: 'abc',
      assigneeId: 'u-2',
      assigneeName: 'Bob',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl,
      user: { id: 'u-1', name: 'Alice', roles: ['assign'] }
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/abc/assign',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ assigneeId: 'u-2', assigneeName: 'Bob' }),
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-cdp-user-id': 'u-1'
        })
      })
    )
    expect(fetchImpl.mock.calls[0][1].headers['x-cdp-user-roles']).toBeUndefined()
    expect(result).toEqual({ ok: true, workItem })
  })

  test('Surfaces a 403 with status so the service can map to not-authorized', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ detail: 'Forbidden' })
    })

    const result = await assignWorkItem({
      workItemId: 'abc',
      assigneeId: 'u-2',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      status: 403,
      problem: { detail: 'Forbidden' }
    })
  })
})

describe('#unassignWorkItem', () => {
  test('POSTs to the unassign endpoint and returns the cleared work item', async () => {
    const workItem = { id: 'abc', assignedToId: null }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await unassignWorkItem({
      workItemId: 'abc',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl,
      user: { id: 'u-1', roles: ['assign'] }
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/abc/unassign',
      expect.objectContaining({ method: 'POST' })
    )
    expect(result).toEqual({ ok: true, workItem })
  })
})

describe('#addWorkItemNote', () => {
  test('POSTs the note text body to the notes endpoint with user headers', async () => {
    const workItem = {
      id: 'abc',
      notes: [
        {
          id: 'n-1',
          text: 'hello',
          createdAt: '2026-04-27T12:00:00Z',
          createdBy: 'u-1',
          createdByName: 'Alice'
        }
      ]
    }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await addWorkItemNote({
      workItemId: 'abc',
      text: 'hello',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl,
      user: { id: 'u-1', name: 'Alice' }
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/abc/notes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'hello' }),
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-cdp-user-id': 'u-1',
          'x-cdp-user-name': 'Alice'
        })
      })
    )
    expect(result).toEqual({ ok: true, workItem })
  })

  test('Surfaces a 400 with the problem detail so callers can render the engine reason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ detail: 'Note text is required.' })
    })

    const result = await addWorkItemNote({
      workItemId: 'abc',
      text: '',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      problem: { detail: 'Note text is required.' }
    })
  })
})

describe('#assertSafeHeaderValue (epr-zld)', () => {
  test('Accepts a normal string', () => {
    expect(() => assertSafeHeaderValue('Alice Example')).not.toThrow()
  })

  test('Rejects strings containing CR', () => {
    expect(() => assertSafeHeaderValue('Alice\rX-Injected: yes')).toThrow(
      /CR or LF/
    )
  })

  test('Rejects strings containing LF', () => {
    expect(() => assertSafeHeaderValue('Alice\nX-Injected: yes')).toThrow(
      /CR or LF/
    )
  })

  test('Rejects strings containing CRLF', () => {
    expect(() => assertSafeHeaderValue('Alice\r\nX-Injected: yes')).toThrow(
      /CR or LF/
    )
  })

  test('Rejects non-string values', () => {
    expect(() => assertSafeHeaderValue(42)).toThrow(TypeError)
    expect(() => assertSafeHeaderValue(null)).toThrow(TypeError)
    expect(() => assertSafeHeaderValue(undefined)).toThrow(TypeError)
    expect(() => assertSafeHeaderValue(['a', 'b'])).toThrow(TypeError)
    expect(() => assertSafeHeaderValue({})).toThrow(TypeError)
  })
})

describe('#buildHeaders header injection guards (epr-zld)', () => {
  test('Rejects a CR-containing user name before reaching fetch', async () => {
    const fetchImpl = vi.fn()

    const result = await getWorkItems({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl,
      user: {
        id: 'u-1',
        name: 'Alice\r\nX-Injected: yes',
        roles: ['standard']
      }
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/CR or LF/)
  })

  test('Rejects a CR-containing user id before reaching fetch', async () => {
    const fetchImpl = vi.fn()

    const result = await getWorkItems({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl,
      user: { id: 'u-1\rEvil: yes', name: 'Alice', roles: ['standard'] }
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/CR or LF/)
  })

  test('A clean user passes through and headers are forwarded', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 20 })
    })

    const result = await getWorkItems({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl,
      user: { id: 'u-1', name: 'Alice', roles: ['standard'] }
    })

    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const headers = fetchImpl.mock.calls[0][1].headers
    expect(headers['x-cdp-user-id']).toBe('u-1')
    expect(headers['x-cdp-user-name']).toBe('Alice')
    expect(headers['x-cdp-user-roles']).toBeUndefined()
  })
})

describe('#createWorkItem (RA-127, RA-219)', () => {
  const baseArgs = () => ({
    baseUrl: 'http://backend:8085',
    timeoutMs: 1000,
    typeId: 're-accreditation',
    payload: { organisationName: 'Acme' }
  })

  test('POSTs the envelope as JSON to /work-items and returns the created item on 201', async () => {
    const workItem = { id: 'wi-1', typeId: 're-accreditation' }
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 201,
      json: () => Promise.resolve(workItem)
    })

    const result = await createWorkItem({
      ...baseArgs(),
      user: { id: 'u-1', name: 'Alice', roles: ['standard'] },
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://backend:8085/work-items')
    expect(init.method).toBe('POST')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.headers['accept']).toBe('application/json')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.headers['x-cdp-user-id']).toBe('u-1')
    expect(init.headers['x-cdp-user-roles']).toBeUndefined()
    // RA-219: the BFF never sends an applicationReference; the backend
    // generates it server-side.
    const sentBody = JSON.parse(init.body)
    expect(sentBody).toEqual({
      typeId: 're-accreditation',
      payload: { organisationName: 'Acme' },
      source: null
    })
    expect(sentBody).not.toHaveProperty('applicationReference')
    expect(result).toEqual({ ok: true, workItem })
  })

  test('strips a trailing slash from baseUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 201,
      json: () => Promise.resolve({ id: 'wi-1' })
    })
    await createWorkItem({
      ...baseArgs(),
      baseUrl: 'http://backend:8085/',
      fetchImpl
    })
    expect(fetchImpl.mock.calls[0][0]).toBe('http://backend:8085/work-items')
  })

  test('400 with RFC 7807 problem-details body becomes invalid + fieldErrors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 400,
      json: () =>
        Promise.resolve({
          title: 'Validation failed',
          detail: 'One or more fields are invalid',
          errors: { applicationReference: ['Required'] }
        })
    })

    const result = await createWorkItem({ ...baseArgs(), fetchImpl })

    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      status: 400,
      message: 'One or more fields are invalid',
      fieldErrors: { applicationReference: ['Required'] }
    })
  })

  test('400 with an unparseable body becomes invalid with a default message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 400,
      json: () => Promise.reject(new Error('not json'))
    })

    const result = await createWorkItem({ ...baseArgs(), fetchImpl })

    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      status: 400,
      message: 'Backend returned 400'
    })
    expect(result.fieldErrors).toBeUndefined()
  })

  test('401 maps to unauthorized', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ detail: 'Sign in' })
    })
    const result = await createWorkItem({ ...baseArgs(), fetchImpl })
    expect(result).toEqual({
      ok: false,
      reason: 'unauthorized',
      status: 401,
      message: 'Sign in'
    })
  })

  test('403 maps to forbidden', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 403,
      json: () => Promise.resolve({ title: 'Nope' })
    })
    const result = await createWorkItem({ ...baseArgs(), fetchImpl })
    expect(result).toEqual({
      ok: false,
      reason: 'forbidden',
      status: 403,
      message: 'Nope'
    })
  })

  test('5xx maps to server with the upstream status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 503,
      json: () => Promise.resolve({ detail: 'Down' })
    })
    const result = await createWorkItem({ ...baseArgs(), fetchImpl })
    expect(result).toEqual({
      ok: false,
      reason: 'server',
      status: 503,
      message: 'Down'
    })
  })

  test('other 4xx maps to server', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 418,
      json: () => Promise.resolve(null)
    })
    const result = await createWorkItem({ ...baseArgs(), fetchImpl })
    expect(result).toEqual({
      ok: false,
      reason: 'server',
      status: 418,
      message: 'Backend returned 418'
    })
  })

  test('AbortError → network with timeout message', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const fetchImpl = vi.fn().mockRejectedValue(abort)
    const result = await createWorkItem({ ...baseArgs(), fetchImpl })
    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'Request timed out'
    })
  })

  test('thrown error → network with the error message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await createWorkItem({ ...baseArgs(), fetchImpl })
    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'ECONNREFUSED'
    })
  })

  test('omits user-* headers when no user is supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 201,
      json: () => Promise.resolve({ id: 'wi-1' })
    })
    await createWorkItem({ ...baseArgs(), fetchImpl })
    const headers = fetchImpl.mock.calls[0][1].headers
    expect(headers['x-cdp-user-id']).toBeUndefined()
    expect(headers['x-cdp-user-name']).toBeUndefined()
    expect(headers['x-cdp-user-roles']).toBeUndefined()
  })
})

describe('#buildHeaders signing integration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('attaches x-cdp-auth-* signing headers to outbound requests when AUTH_SHARED_SECRET is set', async () => {
    const realGet = config.get.bind(config)
    vi.spyOn(config, 'get').mockImplementation((key) =>
      key === 'auth.sharedSecret' ? 'integration-test-secret' : realGet(key)
    )

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 20 })
    })

    await getWorkItems({
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    const headers = fetchImpl.mock.calls[0][1].headers
    expect(headers['x-cdp-auth-timestamp']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
    )
    expect(headers['x-cdp-auth-nonce']).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(headers['x-cdp-auth-signature']).toBeDefined()
  })
})

describe('#approveReAccreditation (RA-132)', () => {
  test('POSTs to the type-specific approve endpoint and returns the work item on 200', async () => {
    const workItem = { id: 'wi-1', stateId: 'approved' }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await approveReAccreditation({
      workItemId: 'wi-1',
      baseUrl: 'http://backend:8085/',
      timeoutMs: 1000,
      fetchImpl,
      user: { id: 'u-1', name: 'Alice' }
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/re-accreditation/wi-1/approve',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          accept: 'application/json',
          'x-cdp-user-id': 'u-1',
          'x-cdp-user-name': 'Alice'
        })
      })
    )
    expect(result).toEqual({ ok: true, workItem })
  })

  test.each([
    [400, 'invalid'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'conflict'],
    [500, 'server']
  ])(
    'maps HTTP %s to reason %s with the problem detail',
    async (status, reason) => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve({ detail: `boom ${status}` })
      })

      const result = await approveReAccreditation({
        workItemId: 'wi-1',
        baseUrl: 'http://backend:8085',
        timeoutMs: 1000,
        fetchImpl
      })

      expect(result).toEqual({
        ok: false,
        reason,
        status,
        message: `boom ${status}`
      })
    }
  )

  test('falls back to a generic message when the problem body has neither detail nor title', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({})
    })

    const result = await approveReAccreditation({
      workItemId: 'wi-1',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'server',
      status: 503,
      message: 'Backend returned 503'
    })
  })

  test('returns a network reason and the abort message when the request times out', async () => {
    const abortError = Object.assign(new Error('aborted'), {
      name: 'AbortError'
    })
    const fetchImpl = vi.fn().mockRejectedValue(abortError)

    const result = await approveReAccreditation({
      workItemId: 'wi-1',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'Request timed out'
    })
  })

  test('returns a network reason and the underlying error message on other transport errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'))

    const result = await approveReAccreditation({
      workItemId: 'wi-1',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'connection refused'
    })
  })
})

describe('#extendWorkItemSla (RA-131)', () => {
  test('returns ok=true with workItem on 200', async () => {
    const workItem = { id: 'wi-1', stateId: 'submitted' }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await extendWorkItemSla({
      workItemId: 'wi-1',
      reason: 'Need more time',
      additionalDuration: 'P7D',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/wi-1/sla/extend',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal)
      })
    )
    expect(result).toEqual({ ok: true, workItem })
  })

  test('sends correct JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'wi-1' })
    })

    await extendWorkItemSla({
      workItemId: 'wi-1',
      reason: 'Test reason',
      additionalDuration: 'P14D',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    const [, init] = fetchImpl.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).toEqual({ reason: 'Test reason', additionalDuration: 'P14D' })
  })

  test('returns forbidden on 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ title: 'Forbidden' })
    })

    const result = await extendWorkItemSla({
      workItemId: 'wi-1',
      reason: 'reason',
      additionalDuration: 'P7D',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'forbidden',
      status: 403,
      message: 'Forbidden'
    })
  })

  test('returns not-found on 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'Work item not found' })
    })

    const result = await extendWorkItemSla({
      workItemId: 'wi-1',
      reason: 'reason',
      additionalDuration: 'P7D',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'not-found',
      status: 404,
      message: 'Work item not found'
    })
  })

  test('returns conflict on 409', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ title: 'Conflict' })
    })

    const result = await extendWorkItemSla({
      workItemId: 'wi-1',
      reason: 'reason',
      additionalDuration: 'P7D',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'conflict',
      status: 409,
      message: 'Conflict'
    })
  })

  test('returns network reason on AbortError', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const fetchImpl = vi.fn().mockRejectedValue(abortError)

    const result = await extendWorkItemSla({
      workItemId: 'wi-1',
      reason: 'reason',
      additionalDuration: 'P7D',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'Request timed out'
    })
  })

  test('returns network reason on transport error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await extendWorkItemSla({
      workItemId: 'wi-1',
      reason: 'reason',
      additionalDuration: 'P7D',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'ECONNREFUSED'
    })
  })
})

describe('#overrideWorkItemSla (RA-131)', () => {
  test('returns ok=true with workItem on 200', async () => {
    const workItem = { id: 'wi-2' }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workItem)
    })

    const result = await overrideWorkItemSla({
      workItemId: 'wi-2',
      reason: 'Reset clock',
      newTargetDuration: 'P30D',
      newStartedAt: '2024-01-15T09:00:00.000Z',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend:8085/work-items/wi-2/sla/override',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal)
      })
    )
    expect(result).toEqual({ ok: true, workItem })
  })

  test('sends correct JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'wi-2' })
    })

    await overrideWorkItemSla({
      workItemId: 'wi-2',
      reason: 'Override reason',
      newTargetDuration: 'P90D',
      newStartedAt: '2024-03-01T00:00:00.000Z',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    const [, init] = fetchImpl.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      reason: 'Override reason',
      newTargetDuration: 'P90D',
      newStartedAt: '2024-03-01T00:00:00.000Z'
    })
  })

  test('returns invalid on 422', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ detail: 'Unprocessable entity' })
    })

    const result = await overrideWorkItemSla({
      workItemId: 'wi-2',
      reason: 'reason',
      newTargetDuration: 'P30D',
      newStartedAt: '2024-01-15T09:00:00.000Z',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      status: 422,
      message: 'Unprocessable entity'
    })
  })

  test('returns network reason on transport error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'))

    const result = await overrideWorkItemSla({
      workItemId: 'wi-2',
      reason: 'reason',
      newTargetDuration: 'P30D',
      newStartedAt: '2024-01-15T09:00:00.000Z',
      baseUrl: 'http://backend:8085',
      timeoutMs: 1000,
      fetchImpl
    })

    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'connection refused'
    })
  })
})
