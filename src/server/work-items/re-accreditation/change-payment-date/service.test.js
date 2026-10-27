import { describe, expect, test, vi } from 'vitest'

import { createChangePaymentDateService } from './service.js'

const ID = '11111111-1111-1111-1111-111111111111'

function serviceWith(result) {
  const changePaymentDate = vi.fn().mockResolvedValue(result)
  return {
    service: createChangePaymentDateService({ changePaymentDate }),
    changePaymentDate
  }
}

const args = { workItemId: ID, paymentDate: '2026-07-20', reason: 'Typo' }

describe('createChangePaymentDateService', () => {
  test('sends the id, plain date and reason, and the user', async () => {
    const user = { id: 'u1' }
    const { service, changePaymentDate } = serviceWith({
      ok: true,
      workItem: { id: ID }
    })
    await service.changePaymentDateForWorkItem({ ...args, user })
    expect(changePaymentDate).toHaveBeenCalledWith({ ...args, user })
  })

  test('returns the updated work item on success', async () => {
    const workItem = { id: ID, stateId: 'duly-made' }
    const { service } = serviceWith({ ok: true, workItem })
    await expect(service.changePaymentDateForWorkItem(args)).resolves.toEqual({
      ok: true,
      workItem
    })
  })

  test('surfaces the outcome and errorCode on failure', async () => {
    const { service } = serviceWith({
      ok: false,
      reason: 'invalid',
      status: 400,
      errorCode: 'payment-date-reason-required',
      message: 'A reason is required.'
    })
    await expect(service.changePaymentDateForWorkItem(args)).resolves.toEqual({
      ok: false,
      outcome: 'invalid',
      status: 400,
      errorCode: 'payment-date-reason-required',
      message: 'A reason is required.'
    })
  })

  test('maps a 409 to the conflict outcome with a null errorCode', async () => {
    const { service } = serviceWith({
      ok: false,
      reason: 'conflict',
      status: 409,
      message: 'terminal'
    })
    const result = await service.changePaymentDateForWorkItem(args)
    expect(result.outcome).toBe('conflict')
    expect(result.errorCode).toBeNull()
  })

  test.each([
    [{ ...args, workItemId: '' }, 'workItemId'],
    [{ ...args, paymentDate: ' ' }, 'paymentDate'],
    [{ ...args, reason: '' }, 'reason']
  ])('rejects a blank argument', async (bad, name) => {
    const { service, changePaymentDate } = serviceWith({ ok: true })
    await expect(service.changePaymentDateForWorkItem(bad)).rejects.toThrow(
      name
    )
    expect(changePaymentDate).not.toHaveBeenCalled()
  })
})
