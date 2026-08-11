import { describe, expect, test, vi } from 'vitest'

import { createDulyMakingService } from './service.js'

const ID = '11111111-1111-1111-1111-111111111111'

function serviceWith(result) {
  const dulyMake = vi.fn().mockResolvedValue(result)
  return { service: createDulyMakingService({ dulyMake }), dulyMake }
}

describe('createDulyMakingService', () => {
  test('sends the work item id and the plain date, and nothing else', () => {
    const { service, dulyMake } = serviceWith({
      ok: true,
      workItem: { id: ID }
    })
    return service
      .dulyMakeWorkItem({ workItemId: ID, paymentDate: '2026-03-27' })
      .then(() => {
        expect(dulyMake).toHaveBeenCalledWith({
          workItemId: ID,
          paymentDate: '2026-03-27',
          user: null
        })
      })
  })

  test('returns the updated work item on success', async () => {
    const workItem = { id: ID, stateId: 'duly-made' }
    const { service } = serviceWith({ ok: true, workItem })
    await expect(
      service.dulyMakeWorkItem({ workItemId: ID, paymentDate: '2026-03-27' })
    ).resolves.toEqual({ ok: true, workItem })
  })

  test('forwards the user', async () => {
    const user = { id: 'u1', name: 'Case Worker' }
    const { service, dulyMake } = serviceWith({ ok: true, workItem: {} })
    await service.dulyMakeWorkItem({
      workItemId: ID,
      paymentDate: '2026-03-27',
      user
    })
    expect(dulyMake).toHaveBeenCalledWith(expect.objectContaining({ user }))
  })

  test('surfaces errorCode so the controller can bind it to the field', async () => {
    const { service } = serviceWith({
      ok: false,
      reason: 'invalid',
      status: 400,
      errorCode: 'payment-date-in-future',
      message: 'Payment date must not be in the future.'
    })
    await expect(
      service.dulyMakeWorkItem({ workItemId: ID, paymentDate: '2027-01-01' })
    ).resolves.toEqual({
      ok: false,
      outcome: 'invalid',
      status: 400,
      errorCode: 'payment-date-in-future',
      message: 'Payment date must not be in the future.'
    })
  })

  test('errorCode defaults to null when the backend sent none', async () => {
    const { service } = serviceWith({
      ok: false,
      reason: 'conflict',
      status: 409,
      message: 'Wrong state'
    })
    const result = await service.dulyMakeWorkItem({
      workItemId: ID,
      paymentDate: '2026-03-27'
    })
    expect(result.errorCode).toBeNull()
    expect(result.outcome).toBe('conflict')
  })

  test('an unknown reason degrades to the generic server outcome', async () => {
    const { service } = serviceWith({
      ok: false,
      reason: 'teapot',
      status: 418
    })
    const result = await service.dulyMakeWorkItem({
      workItemId: ID,
      paymentDate: '2026-03-27'
    })
    expect(result.outcome).toBe('server')
  })

  test.each([
    ['missing work item id', { workItemId: '', paymentDate: '2026-03-27' }],
    ['blank work item id', { workItemId: '   ', paymentDate: '2026-03-27' }],
    ['missing payment date', { workItemId: ID, paymentDate: '' }],
    ['non-string payment date', { workItemId: ID, paymentDate: 20260327 }]
  ])('throws on %s rather than calling the backend', async (_label, args) => {
    const { service, dulyMake } = serviceWith({ ok: true, workItem: {} })
    await expect(service.dulyMakeWorkItem(args)).rejects.toThrow()
    expect(dulyMake).not.toHaveBeenCalled()
  })
})
