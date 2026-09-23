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

    // 31/2 is well-formed but not a real day, so it is caught by the
    // round-trip check. These are caught a step earlier, by the shape
    // check: a non-numeric or wrongly-sized part never becomes a Date at
    // all. Same message either way — the caseworker does not care which
    // guard rejected it, and a partial year is the likeliest real typo.
    it.each([
      ['non-numeric day', { day: 'abc', month: '7', year: '2026' }],
      ['two-digit year', { day: '1', month: '7', year: '26' }],
      ['whitespace month', { day: '1', month: ' ', year: '2026' }]
    ])(
      'returns invalid for a malformed deadline (%s)',
      async (_label, deadline) => {
        const result = await service.extendSla({
          workItemId: 'abc',
          reason: 'valid reason',
          deadline,
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
      }
    )

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

    // RA-601: the extension-only rule is gone. Resubmitting the CURRENT
    // deadline is the one surviving date rejection — it is a no-op, not a
    // change, so it must not reach the backend or the audit log.
    it('returns invalid when the deadline is unchanged', async () => {
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
          'The new determination deadline must be different from the current deadline'
      })
      expect(extend).not.toHaveBeenCalled()
    })

    // RA-601, the bug as raised: an EARLIER deadline is now accepted and the
    // derived duration is negative.
    it('accepts an earlier deadline and sends a negative duration', async () => {
      const workItem = { id: 'abc' }
      extend.mockResolvedValue({ ok: true, workItem })

      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'Determination brought forward',
        deadline: { day: '27', month: '5', year: '2026' },
        currentDueDate: CURRENT_DUE_DATE,
        user: { id: 'u1' }
      })

      expect(result).toEqual({ ok: true, workItem })
      expect(extend).toHaveBeenCalledWith(
        expect.objectContaining({ additionalDuration: '-P5D' })
      )
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

  describe('#validateExtendDeadline (RA-447 CM6, RA-601)', () => {
    it('rejects a work item with no current due date at all', () => {
      expect(validateExtendDeadline(A_LATER_DEADLINE, null)).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: 'This application has no determination deadline to change'
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

    it('accepts the day immediately before the current due date', () => {
      const result = validateExtendDeadline(
        { day: '31', month: '5', year: '2026' },
        CURRENT_DUE_DATE
      )
      expect(result).toEqual({
        ok: true,
        value: '2026-05-31',
        additionalDuration: '-P1D'
      })
    })

    // The sign leads the designator. `P-1D` is malformed ISO-8601 and the
    // backend would reject or mis-parse it, so pin the spelling explicitly.
    it('signs a negative duration ahead of the P designator', () => {
      const result = validateExtendDeadline(
        { day: '31', month: '5', year: '2026' },
        CURRENT_DUE_DATE
      )
      expect(result.additionalDuration).toBe('-P1D')
      expect(result.additionalDuration).not.toContain('P-')
    })

    // RA-601: no floor. A deadline in the past relative to *now* is valid —
    // the product owner chose this over a "not before today" guard.
    it('accepts a deadline that is already in the past', () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-15T09:00:00Z'))
        const result = validateExtendDeadline(
          { day: '1', month: '5', year: '2026' },
          CURRENT_DUE_DATE
        )
        expect(result).toEqual({
          ok: true,
          value: '2026-05-01',
          additionalDuration: '-P31D'
        })
      } finally {
        vi.useRealTimers()
      }
    })

    // RA-601: also no floor at the SLA clock's `startedAt`. That value is not
    // even an input to this validator — a deadline years before the work item
    // can plausibly have started is still accepted.
    it('accepts a deadline far earlier than any plausible clock start', () => {
      const result = validateExtendDeadline(
        { day: '1', month: '1', year: '2020' },
        CURRENT_DUE_DATE
      )
      expect(result).toEqual({
        ok: true,
        value: '2020-01-01',
        additionalDuration: '-P2343D'
      })
    })

    // Both operands are UTC midnights, so a UK clock change between them must
    // not shift the gap by an hour and round to the wrong day count. 2026's
    // transitions are 29 March (GMT→BST) and 25 October (BST→GMT); each pair
    // below straddles one of them.
    it.each([
      ['forwards over GMT→BST', '2026-03-01T00:00:00Z', 1, 4, 2026, 'P31D'],
      ['backwards over GMT→BST', '2026-04-01T00:00:00Z', 1, 3, 2026, '-P31D'],
      ['forwards over BST→GMT', '2026-10-01T00:00:00Z', 1, 11, 2026, 'P31D'],
      ['backwards over BST→GMT', '2026-11-01T00:00:00Z', 1, 10, 2026, '-P31D']
    ])(
      'computes an exact whole-day gap %s',
      (_label, currentDue, day, month, year, expected) => {
        const result = validateExtendDeadline(
          { day: String(day), month: String(month), year: String(year) },
          currentDue
        )
        expect(result.ok).toBe(true)
        expect(result.additionalDuration).toBe(expected)
      }
    )
  })
})
