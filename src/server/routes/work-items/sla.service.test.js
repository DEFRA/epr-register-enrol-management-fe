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

// RA-611 put a floor under the new deadline: it may not be earlier than
// TODAY. Every fixture below is therefore measured against a pinned clock
// rather than the real date, so the boundary cases are deterministic and the
// suite does not start failing as wall-clock time walks past 2026-06-01.
// 2026-05-01 sits before every date the accepting cases submit.
const FIXED_NOW = new Date('2026-05-01T12:00:00Z')
const AT = { now: FIXED_NOW }

describe('createSlaService', () => {
  describe('#extendSla', () => {
    let extend
    let service

    beforeEach(() => {
      extend = vi.fn()
      service = createSlaService({ extend, now: () => FIXED_NOW })
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

    // RA-601's still-valid half, kept alive by RA-611: moving the deadline
    // BACKWARDS is legitimate as long as it lands on today or later. 2026-05-27
    // is earlier than the current 2026-06-01 but later than the pinned today,
    // so it is accepted and the derived duration is negative.
    it('accepts an earlier deadline that is still in the future and sends a negative duration', async () => {
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

    // RA-611, the bug as raised: a deadline earlier than today is rejected
    // before it can reach the backend.
    it('returns invalid when the deadline is earlier than today', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        deadline: { day: '30', month: '4', year: '2026' },
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: 'The new determination deadline cannot be earlier than today'
      })
      expect(extend).not.toHaveBeenCalled()
    })

    // The clock the RA-611 floor is measured against is injected, so a service
    // built without one must fall back to the real current time rather than
    // silently accepting everything.
    it('defaults to the real clock when no now is injected', async () => {
      const realClockService = createSlaService({ extend })
      const result = await realClockService.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        deadline: { day: '1', month: '1', year: '2020' },
        currentDueDate: CURRENT_DUE_DATE,
        user: null
      })
      expect(result.ok).toBe(false)
      expect(result.message).toBe(
        'The new determination deadline cannot be earlier than today'
      )
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

  describe('#validateExtendDeadline (RA-447 CM6, RA-601, RA-611)', () => {
    const pastMessage =
      'The new determination deadline cannot be earlier than today'

    it('rejects a work item with no current due date at all', () => {
      expect(validateExtendDeadline(A_LATER_DEADLINE, null, AT)).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: 'This application has no determination deadline to change'
      })
    })

    it('rejects an empty date', () => {
      expect(
        validateExtendDeadline(
          { day: '', month: '', year: '' },
          CURRENT_DUE_DATE,
          AT
        )
      ).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: 'Enter the new determination deadline'
      })
    })

    it('rejects a date that is not a real calendar date', () => {
      expect(
        validateExtendDeadline(
          { day: '31', month: '2', year: '2026' },
          CURRENT_DUE_DATE,
          AT
        )
      ).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: 'Determination deadline must be a real date'
      })
    })

    it('accepts the day immediately after the current due date', () => {
      const result = validateExtendDeadline(
        { day: '2', month: '6', year: '2026' },
        CURRENT_DUE_DATE,
        AT
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
        CURRENT_DUE_DATE,
        AT
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
        CURRENT_DUE_DATE,
        AT
      )
      expect(result.additionalDuration).toBe('-P1D')
      expect(result.additionalDuration).not.toContain('P-')
    })

    // RA-611's floor, at the boundary. Yesterday is out, today is in.
    it('rejects yesterday with the RA-611 message', () => {
      expect(
        validateExtendDeadline(
          { day: '30', month: '4', year: '2026' },
          CURRENT_DUE_DATE,
          AT
        )
      ).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: pastMessage
      })
    })

    it('accepts today itself', () => {
      const result = validateExtendDeadline(
        { day: '1', month: '5', year: '2026' },
        CURRENT_DUE_DATE,
        AT
      )
      expect(result).toEqual({
        ok: true,
        value: '2026-05-01',
        additionalDuration: '-P31D'
      })
    })

    it('accepts tomorrow', () => {
      const result = validateExtendDeadline(
        { day: '2', month: '5', year: '2026' },
        CURRENT_DUE_DATE,
        AT
      )
      expect(result.ok).toBe(true)
      expect(result.additionalDuration).toBe('-P30D')
    })

    // RA-601 remains correct in this one respect: a BACKWARDS move is still
    // legitimate, provided it lands today or later. The negative duration is
    // spelled with the sign ahead of the designator.
    it('accepts a backwards move onto a still-future date', () => {
      const result = validateExtendDeadline(
        { day: '27', month: '5', year: '2026' },
        CURRENT_DUE_DATE,
        AT
      )
      expect(result).toEqual({
        ok: true,
        value: '2026-05-27',
        additionalDuration: '-P5D'
      })
    })

    // Was an RA-601 case asserting acceptance ("no floor at the SLA clock's
    // startedAt"). RA-611 reverses it: a date years in the past is exactly
    // what the floor exists to catch. The coverage is kept, the expectation
    // flipped.
    it('rejects a deadline far earlier than any plausible clock start', () => {
      expect(
        validateExtendDeadline(
          { day: '1', month: '1', year: '2020' },
          CURRENT_DUE_DATE,
          AT
        )
      ).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: pastMessage
      })
    })

    // The past check runs BEFORE the no-op check, so a date that is both in
    // the past AND equal to the current deadline reports the more specific,
    // more actionable problem.
    it('reports the past-date problem ahead of the no-op problem', () => {
      const result = validateExtendDeadline(
        { day: '1', month: '6', year: '2026' },
        CURRENT_DUE_DATE,
        { now: new Date('2026-07-01T09:00:00Z') }
      )
      expect(result.message).toBe(pastMessage)
    })

    // ...and a date that is merely unchanged, with the current deadline still
    // in the future, keeps the RA-601 no-op message.
    it('keeps the no-op message when the unchanged deadline is not in the past', () => {
      const result = validateExtendDeadline(
        { day: '1', month: '6', year: '2026' },
        CURRENT_DUE_DATE,
        AT
      )
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message:
          'The new determination deadline must be different from the current deadline'
      })
    })

    // The shape checks run before the floor, so an unparseable date reports
    // as an unreal date even when the year it names is long past.
    it('reports an unreal date ahead of the past-date floor', () => {
      const result = validateExtendDeadline(
        { day: '30', month: '2', year: '2020' },
        CURRENT_DUE_DATE,
        AT
      )
      expect(result.message).toBe('Determination deadline must be a real date')
    })

    // RA-611: "today" is the UK-local calendar date, not the UTC one. During
    // BST the UK is a day ahead of UTC for the hour after UK midnight, and a
    // UTC floor would accept a date the regulator reads as yesterday. At
    // 23:30Z on 15 June it is 00:30 on 16 June in London.
    describe('resolves today in Europe/London, not UTC', () => {
      const justAfterUkMidnightBst = {
        now: new Date('2026-06-15T23:30:00Z')
      }

      it('rejects the UTC date, which is already yesterday in the UK', () => {
        const result = validateExtendDeadline(
          { day: '15', month: '6', year: '2026' },
          '2026-08-01T00:00:00Z',
          justAfterUkMidnightBst
        )
        expect(result.ok).toBe(false)
        expect(result.message).toBe(pastMessage)
      })

      it('accepts the UK date, which is today in London', () => {
        const result = validateExtendDeadline(
          { day: '16', month: '6', year: '2026' },
          '2026-08-01T00:00:00Z',
          justAfterUkMidnightBst
        )
        expect(result.ok).toBe(true)
        expect(result.additionalDuration).toBe('-P46D')
      })

      // In GMT the UK date and the UTC date agree, so the same instant-shape
      // must not be over-corrected into rejecting a legitimate today.
      it('accepts today in GMT, when UK local time equals UTC', () => {
        const result = validateExtendDeadline(
          { day: '15', month: '12', year: '2026' },
          '2027-01-01T00:00:00Z',
          { now: new Date('2026-12-15T23:30:00Z') }
        )
        expect(result.ok).toBe(true)
      })
    })

    // Defaulting the clock keeps the validator callable with two arguments.
    it('falls back to the real clock when no options are passed', () => {
      const result = validateExtendDeadline(
        { day: '1', month: '1', year: '2020' },
        CURRENT_DUE_DATE
      )
      expect(result.ok).toBe(false)
      expect(result.message).toBe(pastMessage)
    })

    // Both operands are UTC midnights, so a UK clock change between them must
    // not shift the gap by an hour and round to the wrong day count. 2026's
    // transitions are 29 March (GMT→BST) and 25 October (BST→GMT); each pair
    // below straddles one of them. The clock is pinned before all of them so
    // the RA-611 floor never interferes.
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
          currentDue,
          { now: new Date('2026-01-01T00:00:00Z') }
        )
        expect(result.ok).toBe(true)
        expect(result.additionalDuration).toBe(expected)
      }
    )
  })
})
