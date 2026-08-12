import { describe, expect, test, vi } from 'vitest'

import { createDecisionService } from './service.js'

/**
 * RA-410. One call, both outcomes. The service's job is to validate the
 * outcome, hit the single `/decision` endpoint and translate the reply into
 * the result shape every other module service returns.
 */

function okReply(workItem = { id: 'wi-1', stateId: 'approved' }) {
  return { ok: true, workItem }
}

describe('createDecisionService#recordWorkItemDecision', () => {
  test('posts the approved outcome and returns the updated work item', async () => {
    const recordDecision = vi.fn().mockResolvedValue(okReply())
    const service = createDecisionService({ recordDecision })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved',
      user: { id: 'u-1' }
    })

    expect(recordDecision).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      outcome: 'approved',
      user: { id: 'u-1' }
    })
    expect(result).toEqual({
      ok: true,
      workItem: { id: 'wi-1', stateId: 'approved' }
    })
  })

  test('posts `rejected` — the wire value — for a Refused decision', async () => {
    // The UI says "Refused"; the wire says `rejected`. If this ever posts
    // "refused" the backend answers 400 and the whole flow breaks, so the
    // assertion is on the exact string.
    const recordDecision = vi
      .fn()
      .mockResolvedValue(okReply({ id: 'wi-1', stateId: 'rejected' }))
    const service = createDecisionService({ recordDecision })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'rejected'
    })

    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'rejected' })
    )
    expect(result.ok).toBe(true)
    expect(result.workItem.stateId).toBe('rejected')
  })

  test('makes exactly ONE backend call — never two hops', async () => {
    // The two-hop lifecycle is applied server-side. Splitting it here would
    // reintroduce the window where a failure strands a terminal decision.
    const recordDecision = vi.fn().mockResolvedValue(okReply())
    const service = createDecisionService({ recordDecision })

    await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved'
    })

    expect(recordDecision).toHaveBeenCalledTimes(1)
  })

  test.each([['refused'], ['approve'], [''], [null], [undefined]])(
    'refuses to post an invalid outcome (%s) and never calls the backend',
    async (outcome) => {
      const recordDecision = vi.fn()
      const service = createDecisionService({ recordDecision })

      const result = await service.recordWorkItemDecision({
        workItemId: 'wi-1',
        outcome
      })

      expect(recordDecision).not.toHaveBeenCalled()
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        errorCode: 'invalid-outcome',
        message: 'Select the decision for this application.'
      })
    }
  )

  test.each([
    ['conflict', 409],
    ['not-found', 404],
    ['unauthorized', 401],
    ['server', 500]
  ])(
    'maps a %s backend reply onto the shared outcome vocabulary',
    async (reason, status) => {
      const recordDecision = vi.fn().mockResolvedValue({
        ok: false,
        reason,
        status,
        message: 'nope'
      })
      const service = createDecisionService({ recordDecision })

      const result = await service.recordWorkItemDecision({
        workItemId: 'wi-1',
        outcome: 'approved'
      })

      expect(result.ok).toBe(false)
      expect(result.status).toBe(status)
      expect(result.message).toBe('nope')
    }
  )

  test('surfaces the backend errorCode so the controller can bind a field error', async () => {
    const recordDecision = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'invalid',
      status: 400,
      errorCode: 'invalid-outcome',
      message: 'bad outcome'
    })
    const service = createDecisionService({ recordDecision })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved'
    })

    expect(result.errorCode).toBe('invalid-outcome')
  })

  test('defaults errorCode to null when the backend sends none', async () => {
    const recordDecision = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'server', status: 500 })
    const service = createDecisionService({ recordDecision })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved'
    })

    expect(result.errorCode).toBeNull()
    expect(result.message).toBe('Recording the decision failed')
  })

  test.each([[''], ['   '], [null], [undefined], [42]])(
    'throws for a missing workItemId (%s)',
    async (workItemId) => {
      const service = createDecisionService({ recordDecision: vi.fn() })
      await expect(
        service.recordWorkItemDecision({ workItemId, outcome: 'approved' })
      ).rejects.toThrow('workItemId must be a non-empty string')
    }
  )
})
