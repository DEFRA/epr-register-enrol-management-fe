import { describe, expect, test, vi } from 'vitest'

import {
  applyWorkItemAction,
  completeWorkItemTask,
  getBackendHealth,
  getWorkItems
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
      json: () => Promise.resolve(items)
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
    expect(result).toEqual({ ok: true, items })
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

    expect(result).toEqual({ ok: false, status: 503, error: 'Backend returned 503' })
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

    expect(result).toEqual({ ok: true, items: [] })
  })
})

describe('#completeWorkItemTask', () => {
  test('POSTs to the engine endpoint and returns the updated work item', async () => {
    const workItem = { id: 'abc', stateId: 'submitted', tasks: [], availableActions: [] }
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
      json: () => Promise.resolve({ title: 'Invalid action', detail: 'Task not applicable' })
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
