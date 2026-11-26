import { describe, expect, test, vi } from 'vitest'

import { createChangeValidFromService } from './service.js'

describe('createChangeValidFromService', () => {
  const user = { id: 'u-1', name: 'Alice' }

  test('sends the date and reason to the backend and returns the work item', async () => {
    const changeValidFrom = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })
    const service = createChangeValidFromService({
      typeId: 'add-overseas-site',
      changeValidFrom
    })

    const result = await service.changeValidFromForWorkItem({
      workItemId: 'wi-1',
      effectiveDate: '2026-04-01',
      reason: 'Typo',
      user
    })

    expect(result).toEqual({ ok: true, workItem: { id: 'wi-1' } })
    expect(changeValidFrom).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      effectiveDate: '2026-04-01',
      reason: 'Typo',
      user
    })
  })

  test.each([
    ['unknown', 'server'],
    ['conflict', 'conflict'],
    ['not-found', 'not-found'],
    ['invalid', 'invalid']
  ])('maps a %s failure to the %s outcome', async (reason, outcome) => {
    const service = createChangeValidFromService({
      changeValidFrom: vi.fn().mockResolvedValue({
        ok: false,
        reason,
        status: 409,
        errorCode: 'effective-date-invalid',
        message: 'detail'
      })
    })

    expect(
      await service.changeValidFromForWorkItem({
        workItemId: 'wi-1',
        effectiveDate: '2026-04-01',
        reason: 'Typo'
      })
    ).toEqual({
      ok: false,
      outcome,
      status: 409,
      errorCode: 'effective-date-invalid',
      message: 'detail'
    })
  })

  test.each([
    [{ workItemId: ' ', effectiveDate: '2026-04-01', reason: 'x' }],
    [{ workItemId: 'wi-1', effectiveDate: '', reason: 'x' }],
    [{ workItemId: 'wi-1', effectiveDate: '2026-04-01', reason: ' ' }]
  ])('rejects blank arguments %j', async (args) => {
    const changeValidFrom = vi.fn()
    const service = createChangeValidFromService({ changeValidFrom })
    await expect(service.changeValidFromForWorkItem(args)).rejects.toThrow()
    expect(changeValidFrom).not.toHaveBeenCalled()
  })
})
