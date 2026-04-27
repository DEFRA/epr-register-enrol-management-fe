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
        taskId: 'check-eligibility'
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
})
