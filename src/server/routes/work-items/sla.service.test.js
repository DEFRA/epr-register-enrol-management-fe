import { describe, it, expect, vi, beforeEach } from 'vitest'
import { REASON_MAX_LENGTH, MAX_DAYS, createSlaService } from './sla.service.js'

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
        additionalDays: '7',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        message: 'Reason is required'
      })
      expect(extend).not.toHaveBeenCalled()
    })

    it('returns invalid when reason is whitespace only', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: '   ',
        additionalDays: '7',
        user: null
      })
      expect(result.ok).toBe(false)
      expect(result.outcome).toBe('invalid')
    })

    it('returns invalid when reason exceeds max length', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'x'.repeat(REASON_MAX_LENGTH + 1),
        additionalDays: '7',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        message: `Reason must be ${REASON_MAX_LENGTH} characters or fewer`
      })
      expect(extend).not.toHaveBeenCalled()
    })

    it('returns invalid when additionalDays is not a number', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        additionalDays: 'notanumber',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        message: 'Additional days must be a whole number of at least 1'
      })
      expect(extend).not.toHaveBeenCalled()
    })

    it('returns invalid when additionalDays is zero', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        additionalDays: '0',
        user: null
      })
      expect(result.ok).toBe(false)
      expect(result.outcome).toBe('invalid')
    })

    it('returns invalid when additionalDays is negative', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        additionalDays: '-1',
        user: null
      })
      expect(result.ok).toBe(false)
      expect(result.outcome).toBe('invalid')
    })

    it('returns invalid when additionalDays is a float', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        additionalDays: '3.5',
        user: null
      })
      expect(result.ok).toBe(false)
      expect(result.outcome).toBe('invalid')
    })

    it('returns invalid when additionalDays exceeds MAX_DAYS', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        additionalDays: String(MAX_DAYS + 1),
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        message: `Additional days must be ${MAX_DAYS} or fewer`
      })
      expect(extend).not.toHaveBeenCalled()
    })

    it('calls extend with ISO 8601 duration and returns ok on success', async () => {
      const workItem = { id: 'abc', stateId: 'submitted' }
      extend.mockResolvedValue({ ok: true, workItem })

      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'Need more time',
        additionalDays: '7',
        user: { id: 'u1' }
      })

      expect(extend).toHaveBeenCalledWith({
        workItemId: 'abc',
        reason: 'Need more time',
        additionalDuration: 'P7D',
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
        additionalDays: '3',
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
        additionalDays: '3',
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
        additionalDays: '3',
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
        additionalDays: '3',
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
        additionalDays: '3',
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
        additionalDays: '1',
        user: null
      })
      expect(extend).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'trimmed' })
      )
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

    it('returns invalid when newStartedAt is empty', async () => {
      const result = await service.overrideSla({
        workItemId: 'abc',
        reason: 'valid reason',
        newTargetDays: '30',
        newStartedAt: '',
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        message: 'Start date is required'
      })
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
