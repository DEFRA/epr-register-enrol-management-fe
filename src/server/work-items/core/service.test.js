import { describe, test, expect, vi } from 'vitest'

import { createWorkItemActionsService } from './service.js'

describe('createWorkItemActionsService', () => {
  describe('completeTask', () => {
    test('returns the updated work item on success', async () => {
      const completeTask = vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'abc', stateId: 'submitted' }
      })
      const service = createWorkItemActionsService({ completeTask })

      const result = await service.completeTask({
        workItemId: 'abc',
        taskId: 'check-eligibility'
      })

      expect(completeTask).toHaveBeenCalledWith({
        workItemId: 'abc',
        taskId: 'check-eligibility',
        user: null
      })
      expect(result).toEqual({ ok: true, workItem: { id: 'abc', stateId: 'submitted' } })
    })

    test('translates a 404 into a not-found result', async () => {
      const completeTask = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      const service = createWorkItemActionsService({ completeTask })

      const result = await service.completeTask({ workItemId: 'abc', taskId: 'task' })

      expect(result).toEqual({
        ok: false,
        reason: 'not-found',
        message: 'Work item not found'
      })
    })

    test('translates a transport error into a transport-error result', async () => {
      const completeTask = vi.fn().mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })
      const service = createWorkItemActionsService({ completeTask })

      const result = await service.completeTask({ workItemId: 'abc', taskId: 'task' })

      expect(result).toEqual({
        ok: false,
        reason: 'transport-error',
        message: 'ECONNREFUSED'
      })
    })

    test('rejects an empty workItemId', async () => {
      const service = createWorkItemActionsService({ completeTask: vi.fn() })
      await expect(service.completeTask({ workItemId: '', taskId: 't' })).rejects.toThrow(
        /workItemId/
      )
    })
  })

  describe('applyAction', () => {
    test('translates a 409 into a not-allowed result with the engine message', async () => {
      const applyAction = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        problem: { detail: "Action 'approve' requires every task ..." }
      })
      const service = createWorkItemActionsService({ applyAction })

      const result = await service.applyAction({ workItemId: 'abc', actionId: 'approve' })

      expect(result).toEqual({
        ok: false,
        reason: 'not-allowed',
        status: 409,
        message: "Action 'approve' requires every task ..."
      })
    })

    test('translates a 400 into an invalid result', async () => {
      const applyAction = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        problem: { detail: "Action 'teleport' is not declared" }
      })
      const service = createWorkItemActionsService({ applyAction })

      const result = await service.applyAction({ workItemId: 'abc', actionId: 'teleport' })

      expect(result).toEqual({
        ok: false,
        reason: 'invalid',
        status: 400,
        message: "Action 'teleport' is not declared"
      })
    })

    test('returns the updated work item on success', async () => {
      const applyAction = vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'abc', stateId: 'approved' }
      })
      const service = createWorkItemActionsService({ applyAction })

      const result = await service.applyAction({ workItemId: 'abc', actionId: 'approve' })

      expect(result.ok).toBe(true)
      expect(result.workItem.stateId).toBe('approved')
    })

    test('rejects an empty actionId', async () => {
      const service = createWorkItemActionsService({ applyAction: vi.fn() })
      await expect(service.applyAction({ workItemId: 'abc', actionId: '' })).rejects.toThrow(
        /actionId/
      )
    })
  })

  describe('assign', () => {
    test('forwards the assignee and user to the API client', async () => {
      const assign = vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'abc', assignedToId: 'u-2', assignedToName: 'Bob' }
      })
      const service = createWorkItemActionsService({ assign })

      const result = await service.assign({
        workItemId: 'abc',
        assigneeId: 'u-2',
        assigneeName: 'Bob',
        user: { id: 'u-1' }
      })

      expect(assign).toHaveBeenCalledWith({
        workItemId: 'abc',
        assigneeId: 'u-2',
        assigneeName: 'Bob',
        user: { id: 'u-1' }
      })
      expect(result.ok).toBe(true)
      expect(result.workItem.assignedToId).toBe('u-2')
    })

    test('rejects when assigneeId is empty', async () => {
      const service = createWorkItemActionsService({ assign: vi.fn() })
      await expect(
        service.assign({ workItemId: 'abc', assigneeId: '' })
      ).rejects.toThrow(/assigneeId/)
    })

    test('translates a 403 into a not-authorized result', async () => {
      const assign = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        problem: { detail: 'Standard user cannot assign to others' }
      })
      const service = createWorkItemActionsService({ assign })

      const result = await service.assign({
        workItemId: 'abc',
        assigneeId: 'u-2'
      })

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('not-authorized')
      expect(result.message).toContain('Standard user')
    })
  })

  describe('unassign', () => {
    test('forwards the user to the API client', async () => {
      const unassign = vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: 'abc', assignedToId: null }
      })
      const service = createWorkItemActionsService({ unassign })

      const result = await service.unassign({
        workItemId: 'abc',
        user: { id: 'u-1' }
      })

      expect(unassign).toHaveBeenCalledWith({
        workItemId: 'abc',
        user: { id: 'u-1' }
      })
      expect(result.ok).toBe(true)
    })

    test('translates a 403 into a not-authorized result', async () => {
      const unassign = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        problem: { detail: 'Forbidden' }
      })
      const service = createWorkItemActionsService({ unassign })

      const result = await service.unassign({ workItemId: 'abc' })

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('not-authorized')
    })
  })

  describe('addNote', () => {
    test('forwards trimmed text and user to the API client and returns the updated work item', async () => {
      const addNote = vi.fn().mockResolvedValue({
        ok: true,
        workItem: {
          id: 'abc',
          notes: [{ id: 'n-1', text: 'hello', createdBy: 'alice-1' }]
        }
      })
      const service = createWorkItemActionsService({ addNote })

      const result = await service.addNote({
        workItemId: 'abc',
        text: '  hello  ',
        user: { id: 'alice-1', name: 'Alice' }
      })

      expect(addNote).toHaveBeenCalledWith({
        workItemId: 'abc',
        text: 'hello',
        user: { id: 'alice-1', name: 'Alice' }
      })
      expect(result.ok).toBe(true)
      expect(result.workItem.notes).toHaveLength(1)
    })

    test('rejects blank text locally without calling the API client', async () => {
      const addNote = vi.fn()
      const service = createWorkItemActionsService({ addNote })

      const result = await service.addNote({ workItemId: 'abc', text: '   ' })

      expect(addNote).not.toHaveBeenCalled()
      expect(result).toEqual({
        ok: false,
        reason: 'invalid',
        message: 'Note text is required.'
      })
    })

    test('translates a 400 from the backend (e.g. over-length) into an invalid result', async () => {
      const addNote = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        problem: { detail: 'Note text must be 4000 characters or fewer.' }
      })
      const service = createWorkItemActionsService({ addNote })

      const result = await service.addNote({
        workItemId: 'abc',
        text: 'long-text'
      })

      expect(result).toEqual({
        ok: false,
        reason: 'invalid',
        status: 400,
        message: 'Note text must be 4000 characters or fewer.'
      })
    })

    test('translates a 404 into a not-found result', async () => {
      const addNote = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      const service = createWorkItemActionsService({ addNote })

      const result = await service.addNote({ workItemId: 'abc', text: 'hi' })

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('not-found')
    })

    test('rejects an empty workItemId', async () => {
      const service = createWorkItemActionsService({ addNote: vi.fn() })
      await expect(
        service.addNote({ workItemId: '', text: 'x' })
      ).rejects.toThrow(/workItemId/)
    })
  })
})
