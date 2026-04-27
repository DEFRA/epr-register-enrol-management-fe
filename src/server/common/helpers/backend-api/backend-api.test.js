import { describe, expect, test, vi } from 'vitest'

import { getBackendHealth } from './backend-api.js'

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
