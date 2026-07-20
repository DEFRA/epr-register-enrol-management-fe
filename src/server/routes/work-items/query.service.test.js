import { describe, expect, test, vi } from 'vitest'

import { createQueryService } from './query.service.js'

const args = {
  workItemId: 'wi-1',
  sections: ['business-plan'],
  reason: 'Needs work',
  user: { id: 'u-1' }
}

describe('createQueryService', () => {
  test('forwards the sections, reason and user to the backend client', async () => {
    const raiseQuery = vi.fn().mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-1' }
    })

    const result = await createQueryService({ raiseQuery }).raiseQuery(args)

    expect(raiseQuery).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      sections: ['business-plan'],
      reason: 'Needs work',
      user: { id: 'u-1' }
    })
    expect(result).toEqual({ ok: true, workItem: { id: 'wi-1' } })
  })

  test('defaults the user to null when the caller omits it', async () => {
    const raiseQuery = vi.fn().mockResolvedValue({ ok: true, workItem: {} })

    await createQueryService({ raiseQuery }).raiseQuery({
      workItemId: 'wi-1',
      sections: ['business-plan'],
      reason: 'r'
    })

    expect(raiseQuery).toHaveBeenCalledWith(
      expect.objectContaining({ user: null })
    )
  })

  test.each([
    ['invalid', 'invalid'],
    ['unauthorized', 'forbidden'],
    ['not-authorized', 'forbidden'],
    ['not-allowed', 'conflict'],
    ['not-found', 'not-found'],
    ['network', 'network'],
    ['transport', 'network'],
    ['server', 'server'],
    [undefined, 'server']
  ])('maps backend reason %s to outcome %s', async (reason, outcome) => {
    const raiseQuery = vi
      .fn()
      .mockResolvedValue({ ok: false, reason, message: 'boom' })

    const result = await createQueryService({ raiseQuery }).raiseQuery(args)

    expect(result).toEqual({ ok: false, outcome, message: 'boom' })
  })

  test('falls back to a generic message when the backend gives none', async () => {
    const raiseQuery = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'server' })

    const result = await createQueryService({ raiseQuery }).raiseQuery(args)

    expect(result.message).toBe('Could not send the query')
  })

  test('uses the real backend client by default', () => {
    expect(typeof createQueryService().raiseQuery).toBe('function')
  })
})
