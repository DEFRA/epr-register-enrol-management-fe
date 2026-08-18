import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  REASON_MAX_LENGTH,
  createSlaService,
  validateExtendDeadline
} from './sla.service.js'

// Fixed "current due date" for the extend fixtures below; 2026-07-01 is 30
// days after it, an unambiguous extension.
const CURRENT_DUE_DATE = '2026-06-01T00:00:00Z'
const A_LATER_DEADLINE = { day: '1', month: '7', year: '2026' }

describe('createSlaService', () => {
  describe('#extendSla', () => {
    let extend
    let service

    beforeEach(() => {
      extend = vi.fn()
      service = createSlaService({ extend })
    })

    it('returns invalid when reason is empty', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: '',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'reason',
        message: 'Reason is required'
      })
      expect(extend).not.toHaveBeenCalled()
    })

    it('returns invalid when reason is whitespace only', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: '   ',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result.ok).toBe(false)
      expect(result.outcome).toBe('invalid')
    })

    it('returns invalid when reason exceeds max length', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'x'.repeat(REASON_MAX_LENGTH + 1),
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'reason',
        message: `Reason must be ${REASON_MAX_LENGTH} characters or fewer`
      })
      expect(extend).not.toHaveBeenCalled()
    })

    it('returns invalid when the deadline is empty', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        deadline: { day: '', month: '', year: '' },
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: 'Enter the new determination deadline'
      })
      expect(extend).not.toHaveBeenCalled()
    })

    it('returns invalid when the deadline is not a real date', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        deadline: { day: '31', month: '2', year: '2026' },
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: 'Determination deadline must be a real date'
      })
      expect(extend).not.toHaveBeenCalled()
    })

    // RA-447 CM6: extension-only, not a reduction. On-or-before the current
    // due date is rejected, however small the gap.
    it('returns invalid when the deadline is not after the current due date', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        deadline: { day: '1', month: '6', year: '2026' },
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message:
          'The new determination deadline must be after the current deadline'
      })
      expect(extend).not.toHaveBeenCalled()
    })

    // RA-447 CM6 removed the cap entirely — a deadline far beyond the old
    // 31-day maximum is accepted.
    it('accepts a deadline far beyond the old 31-day cap', async () => {
      const workItem = { id: 'abc' }
      extend.mockResolvedValue({ ok: true, workItem })

      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        deadline: { day: '1', month: '1', year: '2027' },
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })

      expect(result).toEqual({ ok: true, workItem })
      expect(extend).toHaveBeenCalledWith(
        expect.objectContaining({ additionalDuration: 'P214D' })
      )
    })

    it('calls extend with ISO 8601 duration derived from the date gap and returns ok on success', async () => {
      const workItem = { id: 'abc', stateId: 'submitted' }
      extend.mockResolvedValue({ ok: true, workItem })

      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'Need more time',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: { id: 'u1' }
      })

      expect(extend).toHaveBeenCalledWith({
        workItemId: 'abc',
        reason: 'Need more time',
        additionalDuration: 'P30D',
        user: { id: 'u1' }
      })
      expect(result).toEqual({ ok: true, workItem })
    })

    it('maps conflict backend result', async () => {
      extend.mockResolvedValue({
        ok: false,
        reason: 'conflict',
        message: 'Conflict'
      })
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'reason',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'conflict',
        message: 'Conflict'
      })
    })

    it('maps forbidden backend result', async () => {
      extend.mockResolvedValue({
        ok: false,
        reason: 'forbidden',
        message: 'Forbidden'
      })
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'reason',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'forbidden',
        message: 'Forbidden'
      })
    })

    it('maps not-found backend result', async () => {
      extend.mockResolvedValue({
        ok: false,
        reason: 'not-found',
        message: 'Not found'
      })
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'reason',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'not-found',
        message: 'Not found'
      })
    })

    it('maps network backend result', async () => {
      extend.mockResolvedValue({
        ok: false,
        reason: 'network',
        message: 'Timeout'
      })
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'reason',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'network',
        message: 'Timeout'
      })
    })

    it('defaults outcome to server when backend reason missing', async () => {
      extend.mockResolvedValue({ ok: false, message: 'Boom' })
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'reason',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({ ok: false, outcome: 'server', message: 'Boom' })
    })

    it('trims reason before calling backend', async () => {
      const workItem = { id: 'abc' }
      extend.mockResolvedValue({ ok: true, workItem })
      await service.extendSla({
        workItemId: 'abc',
        reason: '  trimmed  ',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(extend).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'trimmed' })
      )
    })
  })

  describe('#validateExtendDeadline (RA-447 CM6)', () => {
    it('rejects a work item with no current due date at all', () => {
      expect(validateExtendDeadline(A_LATER_DEADLINE, null)).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: 'This application has no determination deadline to extend'
      })
    })

    it('accepts the day immediately after the current due date', () => {
      const result = validateExtendDeadline(
        { day: '2', month: '6', year: '2026' },
        CURRENT_DUE_DATE
      )
      expect(result).toEqual({
        ok: true,
        value: '2026-06-02',
        additionalDuration: 'P1D'
      })
    })
  })

  describe('#overrideSla', () => {
    let override
    let service

    beforeEach(() => {
      override = vi.fn()
      service = createSlaService({ override })
    })

    it('returns invalid when reason is empty', async () => {
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: '',
        newTargetDays: '30',
        newStartedAt: '2024-01-01T00:00:00Z',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        message: 'Reason is required'
      })
    })

    it('returns invalid when reason exceeds max length', async () => {
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'x'.repeat(REASON_MAX_LENGTH + 1),
        newTargetDays: '30',
        newStartedAt: '2024-01-01T00:00:00Z',
        user: null
      })
      expect(result.ok).toBe(false)
      expect(result.outcome).toBe('invalid')
    })

    it('returns invalid when newTargetDays is not a positive integer', async () => {
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'valid reason',
        newTargetDays: 'abc',
        newStartedAt: '2024-01-01T00:00:00Z',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        message: 'Target duration must be a whole number of at least 1'
      })
    })

    it('returns invalid when newTargetDays is zero', async () => {
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'valid reason',
        newTargetDays: '0',
        newStartedAt: '2024-01-01T00:00:00Z',
        user: null
      })
      expect(result.ok).toBe(false)
      expect(result.outcome).toBe('invalid')
    })

    it('omits newStartedAt from BE call when not provided (BA confirmed: BE defaults to today)', async () => {
      const workItem = { id: 'abc' }
      override.mockResolvedValue({ ok: true, workItem })

      await service.overrideSla({
        workItemId: 'abc',
        reason: 'valid reason',
        newTargetDays: '30',
        newStartedAt: '',
        user: null
      })

      expect(override).toHaveBeenCalledWith(
        expect.not.objectContaining({ newStartedAt: expect.anything() })
      )
    })

    it('returns invalid when newStartedAt is not a valid date', async () => {
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'valid reason',
        newTargetDays: '30',
        newStartedAt: 'not-a-date',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        message: 'Start date is not a valid date'
      })
    })

    it('calls override with ISO 8601 duration and ISO datetime and returns ok', async () => {
      const workItem = { id: 'abc' }
      override.mockResolvedValue({ ok: true, workItem })

      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'Reset clock',
        newTargetDays: '30',
        newStartedAt: '2024-01-15T09:00:00Z',
        user: { id: 'u1' }
      })

      expect(override).toHaveBeenCalledWith({
        workItemId: 'abc',
        reason: 'Reset clock',
        newTargetDuration: 'P30D',
        newStartedAt: new Date('2024-01-15T09:00:00Z').toISOString(),
        user: { id: 'u1' }
      })
      expect(result).toEqual({ ok: true, workItem })
    })

    it('maps conflict backend result', async () => {
      override.mockResolvedValue({
        ok: false,
        reason: 'conflict',
        message: 'Conflict'
      })
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'reason',
        newTargetDays: '30',
        newStartedAt: '2024-01-01T00:00:00Z',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'conflict',
        message: 'Conflict'
      })
    })

    it('maps forbidden backend result', async () => {
      override.mockResolvedValue({
        ok: false,
        reason: 'forbidden',
        message: 'Forbidden'
      })
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'reason',
        newTargetDays: '30',
        newStartedAt: '2024-01-01T00:00:00Z',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'forbidden',
        message: 'Forbidden'
      })
    })

    it('maps network backend result', async () => {
      override.mockResolvedValue({
        ok: false,
        reason: 'network',
        message: 'Timeout'
      })
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'reason',
        newTargetDays: '30',
        newStartedAt: '2024-01-01T00:00:00Z',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'network',
        message: 'Timeout'
      })
    })

    it('defaults outcome to server when backend reason missing', async () => {
      override.mockResolvedValue({ ok: false, message: 'Boom' })
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'reason',
        newTargetDays: '10',
        newStartedAt: '2024-01-01T00:00:00Z',
        user: null
      })
      expect(result).toEqual({ ok: false, outcome: 'server', message: 'Boom' })
    })
  })
})
