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

// RA-611 puts a floor under the new deadline: the LATER of the duly-made date
// (the SLA clock's start) and 1 January of the CURRENT CALENDAR YEAR. The
// previous revision read that year off `payload.accreditationYear`, which QA
// proved wrong — it is the year the accreditation is valid for, which runs
// AHEAD of determination — so the year now comes from the clock and these
// fixtures pin it.
//
// EVERY case that reaches the floor pins `now`. Left to the real clock the
// whole file would change behaviour on 1 January, when the year bound moves
// past the 2026 dates below; `moves the 1 January bound with the clock` is the
// case that proves that movement deliberately.
const NOW = new Date('2026-10-05T09:00:00Z')

// The default bounds make the DULY-MADE date the binding floor (3 March 2026
// is later than 1 January 2026), and it sits before every date the accepting
// cases submit.
const SLA_STARTED_AT = '2026-03-03T00:00:00Z'
const BOUNDS = { slaStartedAt: SLA_STARTED_AT, now: NOW }

// What the controller passes through to `extendSla`, which reads its clock
// from the service rather than from its arguments: only the work item's own
// duly-made anchor travels with the submission.
const ITEM_BOUNDS = { slaStartedAt: SLA_STARTED_AT }

// The two floor messages, byte-for-byte as the caseworker sees them. The
// duly-made date renders in the GDS `d MMMM yyyy` style via the shared
// `formatDateGds` filter.
const DULY_MADE_MESSAGE =
  'The new determination deadline cannot be earlier than 3 March 2026, when the application was duly made'
const JANUARY_MESSAGE =
  'The new determination deadline cannot be earlier than 1 January 2026'
const NO_CLOCK_MESSAGE =
  'This application has no determination deadline to change'

// A second set of bounds in which the 1-JANUARY backstop is the later bound:
// the application was duly made in the previous calendar year.
const JANUARY_BOUND = {
  slaStartedAt: '2025-11-20T00:00:00Z',
  now: NOW
}

describe('createSlaService', () => {
  describe('#extendSla', () => {
    let extend
    let service

    beforeEach(() => {
      extend = vi.fn()
      // The clock is pinned for every service case: `extendSla` reads it
      // once per submission to resolve the 1-January bound's year.
      service = createSlaService({ extend, now: () => NOW })
    })

    it('returns invalid when reason is empty', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: '',
        deadline: A_LATER_DEADLINE,
        currentDueDate: CURRENT_DUE_DATE,
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
          ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
    // BACKWARDS is legitimate as long as it lands on or above the floor.
    // 2026-05-27 is earlier than the current 2026-06-01 and well after the
    // duly-made date, so it is accepted and the derived duration is negative.
    it('accepts an earlier deadline above the floor and sends a negative duration', async () => {
      const workItem = { id: 'abc' }
      extend.mockResolvedValue({ ok: true, workItem })

      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'Determination brought forward',
        deadline: { day: '27', month: '5', year: '2026' },
        currentDueDate: CURRENT_DUE_DATE,
        ...ITEM_BOUNDS,
        user: { id: 'u1' }
      })

      expect(result).toEqual({ ok: true, workItem })
      expect(extend).toHaveBeenCalledWith(
        expect.objectContaining({ additionalDuration: '-P5D' })
      )
    })

    // RA-611 as respecified: a deadline below the floor is rejected before it
    // can reach the backend. 2 March 2026 is the day before the duly-made date.
    it('returns invalid when the deadline is earlier than the duly-made date', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        deadline: { day: '2', month: '3', year: '2026' },
        currentDueDate: CURRENT_DUE_DATE,
        ...ITEM_BOUNDS,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: DULY_MADE_MESSAGE
      })
      expect(extend).not.toHaveBeenCalled()
    })

    // The case the today-floor got wrong, end to end through the service: a
    // date in the PAST is legitimate as long as it is on or above the floor.
    // 15 April 2026 is after the 3 March duly-made date and before the current
    // 1 June deadline, so it is accepted with a negative duration.
    it('accepts a past deadline that is still above the floor', async () => {
      const workItem = { id: 'abc' }
      extend.mockResolvedValue({ ok: true, workItem })

      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'Backdated to the duly made date',
        deadline: { day: '15', month: '4', year: '2026' },
        currentDueDate: CURRENT_DUE_DATE,
        ...ITEM_BOUNDS,
        user: { id: 'u1' }
      })

      expect(result).toEqual({ ok: true, workItem })
      expect(extend).toHaveBeenCalledWith(
        expect.objectContaining({ additionalDuration: '-P47D' })
      )
    })

    // management-be projects `slaDueDate` and `slaStartedAt` off the same clock,
    // so a work item without one has neither. The service reports that rather
    // than dropping the floor and calling the backend unbounded.
    it('returns invalid when the work item has no SLA clock', async () => {
      const result = await service.extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        deadline: A_LATER_DEADLINE,
        currentDueDate: null,
        slaStartedAt: null,
        user: null
      })
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: NO_CLOCK_MESSAGE
      })
      expect(extend).not.toHaveBeenCalled()
    })

    // The service's clock defaults to the real one — the controller injects
    // nothing — so the 1-January bound is live in production. Year-agnostic
    // assertion, for the same reason as the validator's default case.
    it('falls back to the real clock when none is injected', async () => {
      const result = await createSlaService({ extend }).extendSla({
        workItemId: 'abc',
        reason: 'valid reason',
        deadline: { day: '1', month: '1', year: '1990' },
        currentDueDate: CURRENT_DUE_DATE,
        slaStartedAt: '1989-01-01T00:00:00Z',
        user: null
      })
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/1 January \d{4}$/)
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
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
        ...ITEM_BOUNDS,
        user: null
      })
      expect(extend).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'trimmed' })
      )
    })
  })

  describe('#validateExtendDeadline (RA-447 CM6, RA-601, RA-611)', () => {
    it('rejects a work item with no current due date at all', () => {
      expect(validateExtendDeadline(A_LATER_DEADLINE, null, BOUNDS)).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: NO_CLOCK_MESSAGE
      })
    })

    // The floor's anchor comes off the same SLA clock as the due date, so a
    // missing anchor is the same condition and gets the same message. It is
    // reported rather than silently dropping the floor, which would let an
    // unbounded backdate through to a backend that would reject it.
    it('rejects a work item with no SLA start date', () => {
      expect(
        validateExtendDeadline(A_LATER_DEADLINE, CURRENT_DUE_DATE, {
          now: NOW
        })
      ).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message: NO_CLOCK_MESSAGE
      })
    })

    // Called with two arguments there are no bounds at all, so the same
    // explicit branch fires rather than an accidentally unbounded accept.
    it('rejects when no bounds are passed at all', () => {
      const result = validateExtendDeadline(A_LATER_DEADLINE, CURRENT_DUE_DATE)
      expect(result.ok).toBe(false)
      expect(result.message).toBe(NO_CLOCK_MESSAGE)
    })

    it('rejects an empty date', () => {
      expect(
        validateExtendDeadline(
          { day: '', month: '', year: '' },
          CURRENT_DUE_DATE,
          BOUNDS
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
          BOUNDS
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
        BOUNDS
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
        BOUNDS
      )
      expect(result).toEqual({
        ok: true,
        value: '2026-05-31',
        additionalDuration: '-P1D'
      })
    })

    // The sign leads the designator. `P-1D` is malformed ISO-8601 and the
    // backend would reject or mis-parse it, so pin the spelling explicitly.
    // (RA-601 coverage, kept verbatim through both RA-611 floors.)
    it('signs a negative duration ahead of the P designator', () => {
      const result = validateExtendDeadline(
        { day: '31', month: '5', year: '2026' },
        CURRENT_DUE_DATE,
        BOUNDS
      )
      expect(result.additionalDuration).toBe('-P1D')
      expect(result.additionalDuration).not.toContain('P-')
    })

    // RA-611's floor, at the duly-made boundary. Was "yesterday is out, today
    // is in" against the pinned clock; the 29 Sep 2026 spec makes it "the day
    // before the duly-made date is out, the duly-made date itself is in".
    describe('floors at the duly-made date when that is the later bound', () => {
      it('rejects the day before the duly-made date, naming it', () => {
        expect(
          validateExtendDeadline(
            { day: '2', month: '3', year: '2026' },
            CURRENT_DUE_DATE,
            BOUNDS
          )
        ).toEqual({
          ok: false,
          outcome: 'invalid',
          field: 'deadline',
          message: DULY_MADE_MESSAGE
        })
      })

      it('accepts the duly-made date itself', () => {
        const result = validateExtendDeadline(
          { day: '3', month: '3', year: '2026' },
          CURRENT_DUE_DATE,
          BOUNDS
        )
        expect(result).toEqual({
          ok: true,
          value: '2026-03-03',
          additionalDuration: '-P90D'
        })
      })

      // THE case the first cut of RA-611 got wrong. 15 April 2026 is in the
      // past relative to any plausible run of this suite, is after the
      // duly-made date and is before the current deadline: backdating there is
      // exactly what the spec permits, so it must be ACCEPTED.
      it('accepts a date in the past that is still above the floor', () => {
        const result = validateExtendDeadline(
          { day: '15', month: '4', year: '2026' },
          CURRENT_DUE_DATE,
          BOUNDS
        )
        expect(result).toEqual({
          ok: true,
          value: '2026-04-15',
          additionalDuration: '-P47D'
        })
      })

      // Was an RA-601 case asserting acceptance ("no floor at the SLA clock's
      // startedAt"), then an RA-611 case asserting rejection for being in the
      // past. It is still a rejection, but now because it is below the
      // duly-made anchor rather than because it is historic.
      it('rejects a deadline years before the duly-made date', () => {
        expect(
          validateExtendDeadline(
            { day: '1', month: '1', year: '2020' },
            CURRENT_DUE_DATE,
            BOUNDS
          )
        ).toEqual({
          ok: false,
          outcome: 'invalid',
          field: 'deadline',
          message: DULY_MADE_MESSAGE
        })
      })
    })

    // The other bound. JANUARY_BOUND was duly made on 20 November 2025, in the
    // previous accreditation year, so 1 January 2026 is the later bound and the
    // spec's absolute backstop applies.
    describe('floors at 1 January when that is the later bound', () => {
      it('rejects 31 December of the previous year, naming 1 January', () => {
        expect(
          validateExtendDeadline(
            { day: '31', month: '12', year: '2025' },
            CURRENT_DUE_DATE,
            JANUARY_BOUND
          )
        ).toEqual({
          ok: false,
          outcome: 'invalid',
          field: 'deadline',
          message: JANUARY_MESSAGE
        })
      })

      // The LATER bound wins: a date that clears the duly-made anchor but
      // falls in the previous accreditation year is still refused.
      it('rejects a date after the duly-made date but before 1 January', () => {
        const result = validateExtendDeadline(
          { day: '15', month: '12', year: '2025' },
          CURRENT_DUE_DATE,
          JANUARY_BOUND
        )
        expect(result.ok).toBe(false)
        expect(result.message).toBe(JANUARY_MESSAGE)
      })

      it('accepts 1 January itself', () => {
        const result = validateExtendDeadline(
          { day: '1', month: '1', year: '2026' },
          CURRENT_DUE_DATE,
          JANUARY_BOUND
        )
        expect(result).toEqual({
          ok: true,
          value: '2026-01-01',
          additionalDuration: '-P151D'
        })
      })

      // A tie (duly made ON 1 January) takes the 1-January wording, matching
      // management-be's tie-break. Both bounds name the same day, so the date
      // the caseworker reads is right either way.
      it('prefers the 1 January wording when both bounds are the same day', () => {
        const result = validateExtendDeadline(
          { day: '31', month: '12', year: '2025' },
          CURRENT_DUE_DATE,
          { slaStartedAt: '2026-01-01T00:00:00Z', now: NOW }
        )
        expect(result.ok).toBe(false)
        expect(result.message).toBe(JANUARY_MESSAGE)
      })
    })

    // The year bound is read from the CLOCK, so unlike every other rule in
    // this module it MOVES — at midnight on 1 January. Pinning the clock either
    // side of a New Year is the only way to prove that, and it is also what
    // documents why the rest of the file pins a clock at all: without this, the
    // suite's 2026 expectations would start failing on 1 January 2027 with no
    // code change.
    //
    // Both instants are in GMT, where London and UTC agree, so the pair also
    // shows the formatter is not being over-applied. (A New Year in BST does
    // not exist, so London can only be distinguished from zones AHEAD of it —
    // 23:30Z on 31 December is already 2027 in CET, and the server's zone is
    // not the regulator's.)
    describe('moves the 1 January bound with the clock', () => {
      const anchor = '2025-11-20T00:00:00Z'
      const NEW_YEARS_EVE = new Date('2026-12-31T23:30:00Z')
      const NEW_YEARS_DAY = new Date('2027-01-01T00:30:00Z')

      it('accepts 1 December 2026 while the clock still reads 2026', () => {
        const result = validateExtendDeadline(
          { day: '1', month: '12', year: '2026' },
          CURRENT_DUE_DATE,
          { slaStartedAt: anchor, now: NEW_YEARS_EVE }
        )
        expect(result.ok).toBe(true)
        expect(result.value).toBe('2026-12-01')
      })

      it('rejects the same date once the clock reads 2027, naming 2027', () => {
        const result = validateExtendDeadline(
          { day: '1', month: '12', year: '2026' },
          CURRENT_DUE_DATE,
          { slaStartedAt: anchor, now: NEW_YEARS_DAY }
        )
        expect(result.ok).toBe(false)
        expect(result.message).toBe(
          'The new determination deadline cannot be earlier than 1 January 2027'
        )
      })
    })

    // The clock defaults to the real one, so the bound is live in production
    // without the controller passing anything. Asserted against the SHAPE of
    // the message rather than a year, which is the only year-agnostic way to
    // cover the default.
    it('falls back to the real clock when `now` is omitted', () => {
      const result = validateExtendDeadline(
        { day: '1', month: '1', year: '1990' },
        CURRENT_DUE_DATE,
        { slaStartedAt: '1989-01-01T00:00:00Z' }
      )
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(
        /^The new determination deadline cannot be earlier than 1 January \d{4}$/
      )
    })

    // The floor check runs BEFORE the no-op check, so a date that is both
    // below the floor AND equal to the current deadline reports the more
    // specific, more actionable problem.
    it('reports the floor problem ahead of the no-op problem', () => {
      const result = validateExtendDeadline(
        { day: '1', month: '2', year: '2026' },
        '2026-02-01T00:00:00Z',
        BOUNDS
      )
      expect(result.message).toBe(DULY_MADE_MESSAGE)
    })

    // ...and a date that is merely unchanged, with the current deadline above
    // the floor, keeps the RA-601 no-op message.
    it('keeps the no-op message when the unchanged deadline is above the floor', () => {
      const result = validateExtendDeadline(
        { day: '1', month: '6', year: '2026' },
        CURRENT_DUE_DATE,
        BOUNDS
      )
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        field: 'deadline',
        message:
          'The new determination deadline must be different from the current deadline'
      })
    })

    // The shape checks run before the floor, so an unparseable date reports as
    // an unreal date even when the year it names is far below the floor.
    it('reports an unreal date ahead of the floor', () => {
      const result = validateExtendDeadline(
        { day: '30', month: '2', year: '2020' },
        CURRENT_DUE_DATE,
        BOUNDS
      )
      expect(result.message).toBe('Determination deadline must be a real date')
    })

    // The duly-made anchor is an INSTANT, so it has to be read as a UK-local
    // calendar date rather than a UTC one. `dulyMake` stamps midnight UTC,
    // where the two agree, but management-be's backfill migration and seeder
    // stamp a real timestamp — and at 23:30Z during BST the London date is
    // already the next day. management-be floors on the London date, so
    // reading UTC here would name a floor date the backend then rejects.
    describe('resolves the duly-made anchor in Europe/London, not UTC', () => {
      // 23:30Z on 15 June is 00:30 on 16 June in London (BST).
      const bstAnchor = {
        slaStartedAt: '2026-06-15T23:30:00Z',
        now: NOW
      }

      it('rejects the UTC date, which is the day before the UK anchor date', () => {
        const result = validateExtendDeadline(
          { day: '15', month: '6', year: '2026' },
          '2026-08-01T00:00:00Z',
          bstAnchor
        )
        expect(result.ok).toBe(false)
        expect(result.message).toBe(
          'The new determination deadline cannot be earlier than 16 June 2026, when the application was duly made'
        )
      })

      it('accepts the UK anchor date itself', () => {
        const result = validateExtendDeadline(
          { day: '16', month: '6', year: '2026' },
          '2026-08-01T00:00:00Z',
          bstAnchor
        )
        expect(result.ok).toBe(true)
        expect(result.additionalDuration).toBe('-P46D')
      })

      // In GMT the UK date and the UTC date agree, so the correction must not
      // be over-applied and push the floor a day forward.
      it('accepts the anchor date in GMT, when UK local time equals UTC', () => {
        const result = validateExtendDeadline(
          { day: '15', month: '12', year: '2026' },
          '2027-01-01T00:00:00Z',
          { slaStartedAt: '2026-12-15T23:30:00Z', now: NOW }
        )
        expect(result.ok).toBe(true)
      })

      it('names the GMT anchor date in the message', () => {
        const result = validateExtendDeadline(
          { day: '14', month: '12', year: '2026' },
          '2027-01-01T00:00:00Z',
          { slaStartedAt: '2026-12-15T23:30:00Z', now: NOW }
        )
        expect(result.ok).toBe(false)
        expect(result.message).toBe(
          'The new determination deadline cannot be earlier than 15 December 2026, when the application was duly made'
        )
      })
    })

    // Both operands of the day-gap are UTC midnights, so a UK clock change
    // between them must not shift the gap by an hour and round to the wrong
    // day count. 2026's transitions are 29 March (GMT→BST) and 25 October
    // (BST→GMT); each pair below straddles one of them. The anchor is early in
    // the year so the RA-611 floor never interferes.
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
          { slaStartedAt: '2026-01-05T00:00:00Z', now: NOW }
        )
        expect(result.ok).toBe(true)
        expect(result.additionalDuration).toBe(expected)
      }
    )
  })
})
