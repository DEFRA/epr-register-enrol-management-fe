import { describe, expect, test, vi } from 'vitest'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  approveReAccreditation: vi.fn(),
  addWorkItemNote: vi.fn()
}))

import {
  approveReAccreditation,
  addWorkItemNote
} from '#/server/common/helpers/backend-api/backend-api.js'

import {
  APPROVAL_DECISION_NOTE_MAX_LENGTH,
  createApprovalService
} from './service.js'

function buildService({ approve, addNote } = {}) {
  return createApprovalService({
    approve: approve ?? vi.fn(),
    addNote: addNote ?? vi.fn()
  })
}

describe('createApprovalService', () => {
  test('returns ok with the work item when only the approve call is made', async () => {
    const workItem = { id: 'wi-1', stateId: 'approved' }
    const approve = vi.fn().mockResolvedValue({ ok: true, workItem })
    const addNote = vi.fn()

    const result = await buildService({ approve, addNote }).approveWorkItem({
      workItemId: 'wi-1',
      user: { id: 'u-1' }
    })

    expect(addNote).not.toHaveBeenCalled()
    expect(approve).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      user: { id: 'u-1' }
    })
    expect(result).toEqual({ ok: true, workItem })
  })

  test('treats whitespace-only decision notes as empty and skips the notes endpoint', async () => {
    const approve = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })
    const addNote = vi.fn()

    const result = await buildService({ approve, addNote }).approveWorkItem({
      workItemId: 'wi-1',
      decisionNote: '   \n  '
    })

    expect(addNote).not.toHaveBeenCalled()
    expect(approve).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  test('posts a non-empty trimmed decision note before approving', async () => {
    const approve = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })
    const addNote = vi.fn().mockResolvedValue({ ok: true })

    const result = await buildService({ approve, addNote }).approveWorkItem({
      workItemId: 'wi-1',
      decisionNote: '  All checks complete.  ',
      user: { id: 'u-1' }
    })

    expect(addNote).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      text: 'All checks complete.',
      user: { id: 'u-1' }
    })
    expect(approve).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  test('returns outcome=note-failed and does not approve when the note POST fails', async () => {
    const approve = vi.fn()
    const addNote = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      problem: { detail: 'Note too short' }
    })

    const result = await buildService({ approve, addNote }).approveWorkItem({
      workItemId: 'wi-1',
      decisionNote: 'too short'
    })

    expect(approve).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      outcome: 'note-failed',
      status: 400,
      message: 'Note too short'
    })
  })

  test('falls back to a generic message when the note failure has no problem.detail', async () => {
    const addNote = vi.fn().mockResolvedValue({ ok: false, status: 500 })

    const result = await buildService({ addNote }).approveWorkItem({
      workItemId: 'wi-1',
      decisionNote: 'hello'
    })

    expect(result.outcome).toBe('note-failed')
    expect(result.message).toMatch(/Could not save the decision note/)
  })

  test('returns outcome=invalid when the decision note exceeds the max length', async () => {
    const approve = vi.fn()
    const addNote = vi.fn()
    const longNote = 'x'.repeat(APPROVAL_DECISION_NOTE_MAX_LENGTH + 1)

    const result = await buildService({ approve, addNote }).approveWorkItem({
      workItemId: 'wi-1',
      decisionNote: longNote
    })

    expect(addNote).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
    expect(result.outcome).toBe('invalid')
  })

  test.each([
    ['invalid', 'invalid'],
    ['unauthorized', 'unauthorized'],
    ['forbidden', 'forbidden'],
    ['not-found', 'not-found'],
    ['conflict', 'conflict'],
    ['server', 'server'],
    ['network', 'network'],
    ['mystery-future-reason', 'server']
  ])('maps approve reason %s to outcome %s', async (reason, outcome) => {
    const approve = vi.fn().mockResolvedValue({
      ok: false,
      reason,
      status: 500,
      message: 'boom'
    })

    const result = await buildService({ approve }).approveWorkItem({
      workItemId: 'wi-1'
    })

    expect(result).toEqual({
      ok: false,
      outcome,
      status: 500,
      message: 'boom'
    })
  })

  test('uses a default message when the approve failure has none', async () => {
    const approve = vi.fn().mockResolvedValue({ ok: false, reason: 'server' })

    const result = await buildService({ approve }).approveWorkItem({
      workItemId: 'wi-1'
    })

    expect(result.message).toBe('Approval failed')
  })

  test.each([null, undefined, 42, '', '   '])(
    'throws when workItemId is not a non-empty string (%p)',
    async (badId) => {
      await expect(
        buildService().approveWorkItem({ workItemId: badId })
      ).rejects.toThrow(/workItemId must be a non-empty string/)
    }
  )

  test('coerces non-string decision notes to empty', async () => {
    const approve = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })
    const addNote = vi.fn()

    const result = await buildService({ approve, addNote }).approveWorkItem({
      workItemId: 'wi-1',
      decisionNote: 12345
    })

    expect(addNote).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  test('createApprovalService() defaults route through backend-api.js for both approve and addNote', async () => {
    approveReAccreditation.mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-1' }
    })
    addWorkItemNote.mockResolvedValue({ ok: true })

    const service = createApprovalService()
    const result = await service.approveWorkItem({
      workItemId: 'wi-1',
      decisionNote: 'covers the default paths',
      user: { id: 'u-1' }
    })

    expect(addWorkItemNote).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      text: 'covers the default paths',
      user: { id: 'u-1' }
    })
    expect(approveReAccreditation).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      user: { id: 'u-1' }
    })
    expect(result.ok).toBe(true)
  })
})
