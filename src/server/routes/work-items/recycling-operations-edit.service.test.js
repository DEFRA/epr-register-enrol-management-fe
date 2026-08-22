import { describe, expect, test, vi } from 'vitest'

import { createRecyclingOperationsService } from './recycling-operations-edit.service.js'

const args = {
  workItemId: 'wi-1',
  siteId: 'site-1',
  operationCodes: ['R3'],
  user: { id: 'u-1' }
}

describe('createRecyclingOperationsService', () => {
  test('forwards workItemId, siteId, operationCodes and user to the backend client', async () => {
    const update = vi.fn().mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-1' }
    })

    const result = await createRecyclingOperationsService({
      update
    }).updateCodes(args)

    expect(update).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      siteId: 'site-1',
      operationCodes: ['R3'],
      user: { id: 'u-1' }
    })
    expect(result).toEqual({ ok: true, workItem: { id: 'wi-1' } })
  })

  test('defaults the user to null when the caller omits it', async () => {
    const update = vi.fn().mockResolvedValue({ ok: true, workItem: {} })

    await createRecyclingOperationsService({ update }).updateCodes({
      workItemId: 'wi-1',
      siteId: 'site-1',
      operationCodes: ['R3']
    })

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ user: null }))
  })

  test.each([
    ['invalid', 'invalid'],
    ['unauthorized', 'forbidden'],
    ['forbidden', 'forbidden'],
    ['not-found', 'not-found'],
    ['conflict', 'conflict'],
    ['network', 'network'],
    ['server', 'server'],
    [undefined, 'server']
  ])('maps backend reason %s to outcome %s', async (reason, outcome) => {
    const update = vi
      .fn()
      .mockResolvedValue({ ok: false, reason, message: 'boom' })

    const result = await createRecyclingOperationsService({
      update
    }).updateCodes(args)

    expect(result).toEqual({ ok: false, outcome, message: 'boom' })
  })

  test('falls back to a generic message when the backend gives none', async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, reason: 'server' })

    const result = await createRecyclingOperationsService({
      update
    }).updateCodes(args)

    expect(result.message).toBe(
      'Could not update the recycling operation codes'
    )
  })

  test('uses the real backend client by default', () => {
    expect(typeof createRecyclingOperationsService().updateCodes).toBe(
      'function'
    )
  })
})
