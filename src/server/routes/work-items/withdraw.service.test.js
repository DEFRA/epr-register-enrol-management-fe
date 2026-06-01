import { describe, expect, test, vi } from 'vitest'

import {
  WITHDRAW_NOTE_MAX_LENGTH,
  createWithdrawService,
  isWithdrawActionId
} from './withdraw.service.js'

const ID = '11111111-1111-1111-1111-111111111111'
const USER = { id: 'u-1' }

function stubActions(overrides = {}) {
  return {
    addNote: vi.fn().mockResolvedValue({ ok: true }),
    applyAction: vi.fn().mockResolvedValue({
      ok: true,
      workItem: { id: ID, stateId: 'withdrawn' }
    }),
    ...overrides
  }
}

describe('isWithdrawActionId', () => {
  test.each([
    ['withdraw', true],
    ['withdraw-during-assessment', true],
    ['withdraw-during-decision', true],
    ['withdraw-during-duly-made', true],
    ['approve', false],
    ['withdrawal', false],
    ['', false],
    [null, false],
    [undefined, false],
    [123, false]
  ])('isWithdrawActionId(%p) === %p', (input, expected) => {
    expect(isWithdrawActionId(input)).toBe(expected)
  })
})

describe('createWithdrawService.withdrawWorkItem', () => {
  test('rejects unknown action ids without touching the backend', async () => {
    const actions = stubActions()
    const service = createWithdrawService({ workItemActions: actions })

    const result = await service.withdrawWorkItem({
      workItemId: ID,
      actionId: 'approve'
    })

    expect(result).toEqual({
      ok: false,
      outcome: 'invalid',
      message: 'Unsupported withdraw action.'
    })
    expect(actions.addNote).not.toHaveBeenCalled()
    expect(actions.applyAction).not.toHaveBeenCalled()
  })

  test('rejects notes longer than the max length without calling the backend', async () => {
    const actions = stubActions()
    const service = createWithdrawService({ workItemActions: actions })

    const result = await service.withdrawWorkItem({
      workItemId: ID,
      actionId: 'withdraw',
      note: 'x'.repeat(WITHDRAW_NOTE_MAX_LENGTH + 1)
    })

    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('invalid')
    expect(result.message).toContain(`${WITHDRAW_NOTE_MAX_LENGTH}`)
    expect(actions.addNote).not.toHaveBeenCalled()
    expect(actions.applyAction).not.toHaveBeenCalled()
  })

  test('skips the note step when the trimmed note is empty', async () => {
    const actions = stubActions()
    const service = createWithdrawService({ workItemActions: actions })

    const result = await service.withdrawWorkItem({
      workItemId: ID,
      actionId: 'withdraw',
      note: '   ',
      user: USER
    })

    expect(result).toEqual({
      ok: true,
      workItem: { id: ID, stateId: 'withdrawn' }
    })
    expect(actions.addNote).not.toHaveBeenCalled()
    expect(actions.applyAction).toHaveBeenCalledWith({
      workItemId: ID,
      actionId: 'withdraw',
      user: USER
    })
  })

  test('posts the trimmed note before applying the action', async () => {
    const actions = stubActions()
    const service = createWithdrawService({ workItemActions: actions })

    const result = await service.withdrawWorkItem({
      workItemId: ID,
      actionId: 'withdraw-during-assessment',
      note: '  duplicate application  ',
      user: USER
    })

    expect(result.ok).toBe(true)
    expect(actions.addNote).toHaveBeenCalledWith({
      workItemId: ID,
      text: 'duplicate application',
      user: USER
    })
    expect(actions.applyAction).toHaveBeenCalledWith({
      workItemId: ID,
      actionId: 'withdraw-during-assessment',
      user: USER
    })
    expect(actions.addNote.mock.invocationCallOrder[0]).toBeLessThan(
      actions.applyAction.mock.invocationCallOrder[0]
    )
  })

  test('returns note-failed when the note POST fails and never applies the action', async () => {
    const actions = stubActions({
      addNote: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'invalid',
        message: 'note rejected'
      })
    })
    const service = createWithdrawService({ workItemActions: actions })

    const result = await service.withdrawWorkItem({
      workItemId: ID,
      actionId: 'withdraw',
      note: 'rationale'
    })

    expect(result).toEqual({
      ok: false,
      outcome: 'note-failed',
      message: 'note rejected'
    })
    expect(actions.applyAction).not.toHaveBeenCalled()
  })

  test('falls back to a default message when the note service omits one', async () => {
    const actions = stubActions({
      addNote: vi.fn().mockResolvedValue({ ok: false, reason: 'network' })
    })
    const service = createWithdrawService({ workItemActions: actions })

    const result = await service.withdrawWorkItem({
      workItemId: ID,
      actionId: 'withdraw',
      note: 'why'
    })

    expect(result.outcome).toBe('note-failed')
    expect(result.message).toContain('Could not save')
  })

  test.each([
    ['not-allowed', 'conflict'],
    ['not-authorized', 'forbidden'],
    ['not-found', 'not-found'],
    ['network', 'network'],
    ['transport', 'network'],
    ['invalid', 'invalid'],
    ['weird', 'server']
  ])('maps applyAction reason %p to outcome %p', async (reason, outcome) => {
    const actions = stubActions({
      applyAction: vi.fn().mockResolvedValue({
        ok: false,
        reason,
        message: 'nope'
      })
    })
    const service = createWithdrawService({ workItemActions: actions })

    const result = await service.withdrawWorkItem({
      workItemId: ID,
      actionId: 'withdraw'
    })

    expect(result).toEqual({
      ok: false,
      outcome,
      message: 'nope'
    })
  })

  test('falls back to a default action failure message when none provided', async () => {
    const actions = stubActions({
      applyAction: vi.fn().mockResolvedValue({ ok: false, reason: 'server' })
    })
    const service = createWithdrawService({ workItemActions: actions })

    const result = await service.withdrawWorkItem({
      workItemId: ID,
      actionId: 'withdraw'
    })

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Withdrawal failed')
  })

  test('uses the default workItemActions service when none injected', () => {
    expect(() => createWithdrawService()).not.toThrow()
  })

  test('treats non-string note as empty', async () => {
    const actions = stubActions()
    const service = createWithdrawService({ workItemActions: actions })

    const result = await service.withdrawWorkItem({
      workItemId: ID,
      actionId: 'withdraw',
      note: 42
    })

    expect(result.ok).toBe(true)
    expect(actions.addNote).not.toHaveBeenCalled()
  })
})
