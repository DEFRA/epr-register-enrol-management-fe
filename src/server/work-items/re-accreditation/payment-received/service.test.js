import { vi } from 'vitest'

import { createPaymentReceivedService } from './service.js'

const ID = '11111111-1111-1111-1111-111111111111'

describe('#createPaymentReceivedService (RA-523)', () => {
  test('sends the work item id and acting user, and NOTHING else', async () => {
    const paymentReceived = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: ID } })
    const service = createPaymentReceivedService({ paymentReceived })
    const user = { id: 'u-1', name: 'Case Worker' }

    const result = await service.recordPaymentReceived({
      workItemId: ID,
      user
    })

    expect(result).toEqual({ ok: true, workItem: { id: ID } })
    // Asserted with an exact-equality check, not `objectContaining`: the
    // absence of a payment date is the contract. It was captured at
    // duly-make and already sits on the payload, so sending a second one
    // here would let two different dates describe one payment.
    expect(paymentReceived).toHaveBeenCalledWith({ workItemId: ID, user })
  })

  test('defaults the user to null rather than sending undefined', async () => {
    const paymentReceived = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: {} })
    const service = createPaymentReceivedService({ paymentReceived })

    await service.recordPaymentReceived({ workItemId: ID })

    expect(paymentReceived).toHaveBeenCalledWith({
      workItemId: ID,
      user: null
    })
  })

  test.each([
    ['conflict', 409, 'conflict'],
    ['not-found', 404, 'not-found'],
    ['unauthorized', 401, 'unauthorized']
  ])(
    'maps a %s backend reason to its outcome and keeps the status',
    async (reason, status, expected) => {
      const paymentReceived = vi.fn().mockResolvedValue({
        ok: false,
        reason,
        status,
        message: 'Backend said no'
      })
      const service = createPaymentReceivedService({ paymentReceived })

      const result = await service.recordPaymentReceived({ workItemId: ID })

      expect(result).toEqual({
        ok: false,
        outcome: expected,
        status,
        message: 'Backend said no'
      })
    }
  )

  test('supplies a fallback message when the backend gives none', async () => {
    const paymentReceived = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'server', status: 500 })
    const service = createPaymentReceivedService({ paymentReceived })

    const result = await service.recordPaymentReceived({ workItemId: ID })

    expect(result.message).toBe('Recording payment received failed')
  })

  test.each([[''], ['   '], [null], [undefined], [42]])(
    'throws rather than calling the backend for the invalid id %p',
    async (workItemId) => {
      const paymentReceived = vi.fn()
      const service = createPaymentReceivedService({ paymentReceived })

      await expect(
        service.recordPaymentReceived({ workItemId })
      ).rejects.toThrow('workItemId must be a non-empty string')
      expect(paymentReceived).not.toHaveBeenCalled()
    }
  )
})
