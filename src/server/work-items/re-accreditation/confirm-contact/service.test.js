import { describe, expect, test, vi } from 'vitest'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  confirmApplicantContact: vi.fn()
}))

const { confirmApplicantContact } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

import { createConfirmContactService } from './service.js'

describe('createConfirmContactService (RA-527)', () => {
  test('forwards the work item id and acting user to the backend client', async () => {
    const workItem = { id: 'wi-1', stateId: 'approved' }
    const confirmContact = vi.fn().mockResolvedValue({ ok: true, workItem })
    const user = { id: 'u-1', name: 'Alice' }

    const result = await createConfirmContactService({
      confirmContact
    }).confirmApplicantContact({ workItemId: 'wi-1', user })

    expect(confirmContact).toHaveBeenCalledWith({ workItemId: 'wi-1', user })
    expect(result).toEqual({ ok: true, workItem })
  })

  test('defaults the user to null when the caller omits it', async () => {
    const confirmContact = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })

    await createConfirmContactService({
      confirmContact
    }).confirmApplicantContact({ workItemId: 'wi-1' })

    expect(confirmContact).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      user: null
    })
  })

  test.each([
    ['conflict', 409, 'conflict'],
    ['not-found', 404, 'not-found'],
    ['network', undefined, 'network'],
    ['server', 500, 'server']
  ])(
    'maps the backend reason %s to outcome %s',
    async (reason, status, outcome) => {
      const confirmContact = vi.fn().mockResolvedValue({
        ok: false,
        reason,
        status,
        message: 'nope'
      })

      const result = await createConfirmContactService({
        confirmContact
      }).confirmApplicantContact({ workItemId: 'wi-1' })

      expect(result).toEqual({ ok: false, outcome, status, message: 'nope' })
    }
  )

  test('falls back to a generic message when the backend gives none', async () => {
    const confirmContact = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'server', status: 500 })

    const result = await createConfirmContactService({
      confirmContact
    }).confirmApplicantContact({ workItemId: 'wi-1' })

    expect(result.message).toBe('Confirming applicant contact failed')
  })

  test.each([undefined, '', '   '])(
    'throws for a missing work item id (%j)',
    async (workItemId) => {
      await expect(
        createConfirmContactService({
          confirmContact: vi.fn()
        }).confirmApplicantContact({ workItemId })
      ).rejects.toThrow('workItemId must be a non-empty string')
    }
  )

  test('calls the real backend client by default', async () => {
    confirmApplicantContact.mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-1' }
    })

    const result = await createConfirmContactService().confirmApplicantContact({
      workItemId: 'wi-1'
    })

    expect(confirmApplicantContact).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      user: null
    })
    expect(result.ok).toBe(true)
  })
})
