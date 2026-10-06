/**
 * Determination-deadline change service (RA-131, reworked by RA-447 CM6,
 * RA-601 and RA-611).
 *
 * One operation, `extendSla`: validates reason + a new deadline date → calls
 * the BE extend endpoint. There is no upper bound (RA-447 CM6). RA-601
 * removed the "later than the current deadline" rule, so the deadline may be
 * brought forward as well as pushed back; RA-611 then put a FLOOR back under
 * it.
 *
 * RA-611's floor changed TWICE on this branch.
 *
 * The first cut floored the new deadline at TODAY, on the reasoning that a
 * deadline already in the past the moment it is saved is never what the
 * regulator meant. The spec that arrived on 29 Sep 2026 says otherwise: a
 * determination may legitimately be BACKDATED, as far back as the date the
 * application became "duly made" (the first date on which the regulator held
 * all the required data and the application charge was paid), but never
 * before 1 January. The today-floor was therefore REPLACED, not
 * supplemented — keeping it would make the real rule unreachable, because
 * every date it permits is already at or after today.
 *
 * The second cut read "1 January" off the payload's `accreditationYear`, and
 * that was a QA case-blocker. `accreditationYear` is the year the
 * accreditation is VALID FOR, not the current calendar year: management-be
 * stamps it at approval from `Accreditation:CurrentYear` and derives the
 * accreditation's START date from it. Determination happens BEFORE that year
 * begins, so in October 2026 a live case carrying 2027 floored at 1 Jan 2027
 * and refused every date in 2026 — including the case's own existing deadline
 * of 4 Dec 2026. The bound is the CURRENT CALENDAR YEAR, per Anthony Moody's
 * ACs ("not further back than 1st Jan of current year"), confirmed by Giri
 * Nattu in QA on 5 Oct 2026.
 *
 * The floor is therefore the LATER of:
 *   (a) the SLA clock's start date (`slaStartedAt`) — the duly-made anchor;
 *   (b) 1 January of the CURRENT calendar year, read in Europe/London.
 *
 * So the two surviving date rules are: not earlier than that floor, and
 * different from the current deadline.
 *
 * RA-572 removed the sibling `overrideSla` operation and its validation
 * along with the Override journey. The method name and the BE endpoint it
 * wraps are unchanged: only the user-facing copy became "change" wording.
 *
 * Result shape: { ok: true, workItem } OR { ok: false, outcome, message }
 * Outcomes: 'invalid', 'forbidden', 'not-found', 'conflict', 'server', 'network'
 */

import { formatDateGds } from '#/config/nunjucks/filters/format-date.js'

export const REASON_MAX_LENGTH = 500

async function defaultExtend(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.extendWorkItemSla(args)
}

/** Reason validation for the determination-deadline change form. */
function validateReason(reason) {
  const trimmedReason = typeof reason === 'string' ? reason.trim() : ''
  if (!trimmedReason) {
    return { ok: false, outcome: 'invalid', message: 'Reason is required' }
  }
  if (trimmedReason.length > REASON_MAX_LENGTH) {
    return {
      ok: false,
      outcome: 'invalid',
      message: `Reason must be ${REASON_MAX_LENGTH} characters or fewer`
    }
  }
  return { ok: true, reason: trimmedReason }
}

function textOf(value) {
  return value == null ? '' : String(value).trim()
}

function pad(value, length) {
  return String(value).padStart(length, '0')
}

function startOfUtcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Format a whole-day gap as the ISO-8601 duration the backend's
 * `additionalDuration` field expects.
 *
 * RA-601 allows the deadline to move backwards (to any date at or above the
 * RA-611 floor, which since the 29 Sep 2026 spec change may itself be in the
 * past), which makes `days` negative. ISO-8601 puts the sign AHEAD of the `P`
 * designator — `-P5D`, never `P-5D`, which is malformed and would be rejected
 * or mis-parsed by the backend.
 */
function isoDayDuration(days) {
  return days < 0 ? `-P${Math.abs(days)}D` : `P${days}D`
}

/**
 * The IANA timezone the regulator works in. Mirrors
 * `#/config/nunjucks/filters/format-date.js`'s UK_TIMEZONE: the backend is
 * UTC everywhere, and this module is where a UTC instant becomes a UK
 * calendar date. Naming the zone (rather than a fixed offset) keeps BST
 * (UTC+1) and GMT (UTC+0) — and the transitions between them — automatic,
 * and makes the result independent of the server's own TZ.
 */
const UK_TIMEZONE = 'Europe/London'

const ukDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/**
 * The UK-local calendar date of an instant, returned as the UTC midnight of
 * that date so it is directly comparable with the values `parseCalendarDate`
 * produces.
 *
 * Both halves of the floor need this. The duly-made ANCHOR is an instant and
 * not a date: items made duly by `dulyMake` carry a midnight-UTC anchor, where
 * the UTC and London calendar dates always agree; but the backfill migration
 * and the seeder in management-be stamp `StartedAt` from a real timestamp, and
 * for those the two readings can differ by a day: 23:30Z on 15 June is 00:30
 * on 16 June in London during BST. Where they differ, London is the right
 * answer — the regulator types a UK calendar date into the day/month/year
 * boxes, and management-be floors on the London date too, so reading the
 * anchor in UTC here would let the FE name a floor date the backend then
 * rejects with a 422 the caseworker could not satisfy. The CURRENT YEAR half
 * reads the same formatter for the same reason (see `ukCalendarYearOf`).
 */
function ukCalendarPartsOf(instant) {
  return Object.fromEntries(
    ukDateFormatter
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  )
}

function ukCalendarDayOf(instant) {
  const parts = ukCalendarPartsOf(instant)
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  )
}

/**
 * The calendar year an instant falls in, as the regulator reckons it.
 *
 * Deliberately NOT `instant.getFullYear()`: that is the SERVER's zone, and the
 * container's TZ is not the regulator's. The two disagree for an hour either
 * side of New Year — 23:30 on 31 December in London is already 1 January in
 * CET — and that hour decides which year the floor names.
 */
function ukCalendarYearOf(instant) {
  return Number(ukCalendarPartsOf(instant).year)
}

/**
 * RA-611 (29 Sep 2026 spec, corrected after QA on 5 Oct 2026). The lower bound
 * the new deadline may not fall below, and the message naming whichever bound
 * produced it.
 *
 * Two candidates, of which the LATER wins:
 *
 *  (a) The duly-made anchor: the UK calendar date of the SLA clock's start.
 *      management-be stamps `slaStartedAt` when the application became duly
 *      made, so it IS the "first date on which the regulator had all the data
 *      and the charge was paid" the spec names.
 *  (b) 1 January of the CURRENT calendar year, which the ACs make an absolute
 *      backstop: a determination is never backdated into the previous calendar
 *      year, even if the application was duly made before this year began.
 *
 * (b) was WRONG in the previous revision, which read it off the payload's
 * `accreditationYear`. That field is the year the accreditation is valid for,
 * stamped at approval and always AHEAD of determination, so it floored live
 * 2026 cases at 1 Jan 2027 and refused their own existing deadlines. Do not
 * reinstate it. For the same reason, do not reach for any config value named
 * "current year" either: management-be's `Accreditation:CurrentYear` is 2027 —
 * it means "the accreditation year currently open", not today's year — and
 * there is deliberately no FE equivalent to misuse. The current year comes
 * from the injected clock, nothing else.
 *
 * Both bounds are resolved in Europe/London: the clock is an instant, so which
 * calendar year it falls in is a zone question like the anchor's date.
 *
 * Ties go to the 1-January wording: when the application was duly made on
 * 1 January itself both bounds name the same day, and the year bound is the
 * clearer thing to tell the caseworker. management-be tie-breaks the same way.
 *
 * @param {Date} startedAt the SLA clock's start instant
 * @param {Date} now the current instant, from the injectable clock
 * @returns {{ floor: number, message: string }}
 */
function deadlineFloor(startedAt, now) {
  const dulyMadeFloor = ukCalendarDayOf(startedAt)
  const currentYear = ukCalendarYearOf(now)
  const yearFloor = Date.UTC(currentYear, 0, 1)

  if (yearFloor >= dulyMadeFloor) {
    return {
      floor: yearFloor,
      message: `The new determination deadline cannot be earlier than 1 January ${currentYear}`
    }
  }

  return {
    floor: dulyMadeFloor,
    message: `The new determination deadline cannot be earlier than ${formatDateGds(startedAt)}, when the application was duly made`
  }
}

/**
 * Parse a day/month/year triple into a real calendar date, or null when the
 * parts aren't well-formed or don't round-trip to a real date (e.g.
 * 2026-02-30, which `Date.UTC` would otherwise roll forward into March).
 */
function parseCalendarDate(day, month, year) {
  if (
    !/^\d{1,2}$/.test(day) ||
    !/^\d{1,2}$/.test(month) ||
    !/^\d{4}$/.test(year)
  ) {
    return null
  }

  const d = Number(day)
  const m = Number(month)
  const y = Number(year)
  const asUtc = new Date(Date.UTC(y, m - 1, d))
  const isReal =
    asUtc.getUTCFullYear() === y &&
    asUtc.getUTCMonth() === m - 1 &&
    asUtc.getUTCDate() === d

  return isReal ? { date: asUtc, day: d, month: m, year: y } : null
}

/**
 * Parse an ISO instant the backend put on the work item, or null when it is
 * absent or unparseable. Both of the dates this module reads off the work item
 * — the current due date and the SLA clock's start — go through here, so
 * "the backend gave us nothing usable" is one shape rather than two.
 */
function parseInstant(value) {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The SHAPE checks, in the order the ACs fix: empty, then not-a-real-date, then
 * the work item's own dates. Separated from the RULE checks in
 * `validateExtendDeadline` so each half stays readable as the floor rules grow.
 *
 * The SLA clock is the source of BOTH date rules' inputs: management-be
 * projects `slaDueDate` and `slaStartedAt` off the same clock object, so one is
 * null exactly when the other is (confirmed with management-be on this
 * branch). A work item with no clock has no deadline to change and no
 * duly-made anchor to floor a new one at, which is one condition and gets one
 * message — rather than silently dropping the floor and letting an unbounded
 * backdate through to a backend that would reject it.
 *
 * @returns {{ message: string } |
 *   { parsed: object, currentDue: Date, startedAt: Date }}
 */
function resolveDeadlineInputs(deadline, currentDueDate, slaStartedAt) {
  const day = textOf(deadline?.day)
  const month = textOf(deadline?.month)
  const year = textOf(deadline?.year)

  if (day === '' && month === '' && year === '') {
    return { message: 'Enter the new determination deadline' }
  }

  const parsed = parseCalendarDate(day, month, year)
  if (!parsed) {
    return { message: 'Determination deadline must be a real date' }
  }

  const currentDue = parseInstant(currentDueDate)
  const startedAt = parseInstant(slaStartedAt)
  if (!currentDue || !startedAt) {
    return {
      message: 'This application has no determination deadline to change'
    }
  }

  return { parsed, currentDue, startedAt }
}

/**
 * Pure validator for the extend-SLA form's new-deadline date input.
 *
 * RA-447 CM6 replaced the "number of additional days" input (capped by
 * `workItems.sla.maxExtensionDays`) with a `govukDateInput` for the new
 * determination deadline, and dropped the cap entirely.
 *
 * RA-601 removed the direction rule: the new deadline may fall BEFORE the
 * current one, so a regulator can bring a determination forward as well as
 * push it back. RA-611 puts a floor under that freedom without taking it
 * away. Per the 29 Sep 2026 spec, backdating is legitimate — including into
 * the past, which the first cut of RA-611 wrongly forbade — down to but not
 * below `deadlineFloor()`: the later of the duly-made date and 1 January of
 * the current calendar year. Landing exactly ON the floor is accepted.
 *
 * Two date rules therefore survive, checked in this order after the shape
 * checks (empty, then not-a-real-date):
 *   1. not earlier than the floor (RA-611) — see `deadlineFloor`, which also
 *      chooses which of the two bounds the error message names;
 *   2. different from the current deadline (RA-601), because resubmitting the
 *      same date is a no-op that would still be written to the audit log as a
 *      change.
 *
 * The day-count the backend's wire contract still expects
 * (`additionalDuration`, an ISO-8601 duration) is derived here from the gap
 * between the two dates, so the API contract is unchanged even though the
 * user no longer types a day count directly. A backwards move produces a
 * NEGATIVE duration, spelled with the sign ahead of the designator (`-P5D`).
 *
 * @param {{ day?: string, month?: string, year?: string }} deadline
 * @param {string|null|undefined} currentDueDate the work item's current
 *   `slaDueDate`, as an ISO string
 * @param {{ slaStartedAt?: string|null, now?: Date }} [bounds] the two inputs
 *   the RA-611 floor is built from: the SLA clock's start date (the duly-made
 *   anchor), which comes straight off the work item the controller already
 *   loaded, and `now` — the injectable clock the 1-January bound reads the
 *   current calendar year from. Pin `now` in tests that exercise that bound:
 *   left to the real clock, their expectations would change on 1 January.
 * @returns {{ ok: true, value: string, additionalDuration: string } |
 *   { ok: false, outcome: 'invalid', field: 'deadline', message: string }}
 */
export function validateExtendDeadline(
  deadline,
  currentDueDate,
  { slaStartedAt, now = new Date() } = {}
) {
  const invalid = (message) => ({
    ok: false,
    outcome: 'invalid',
    field: 'deadline',
    message
  })

  const resolved = resolveDeadlineInputs(deadline, currentDueDate, slaStartedAt)
  if (resolved.message) {
    return invalid(resolved.message)
  }
  const { parsed, currentDue, startedAt } = resolved
  const currentDueUtcDay = startOfUtcDay(currentDue)

  // RA-611: the floor, checked before the no-op rule — a date below the floor
  // is the more specific and more actionable problem to report, even when it
  // happens to equal the current deadline. Landing exactly ON the floor is
  // accepted, so the comparison is strictly-below.
  const bound = deadlineFloor(startedAt, now)
  if (parsed.date.getTime() < bound.floor) {
    return invalid(bound.message)
  }

  // RA-601: either direction is allowed above the RA-611 floor, so the other
  // surviving date rule is that something actually changes. Equality is the
  // no-op — it would otherwise be submitted to the backend as a zero-day
  // change and recorded in the audit log as a change that moved nothing.
  if (parsed.date.getTime() === currentDueUtcDay) {
    return invalid(
      'The new determination deadline must be different from the current deadline'
    )
  }

  // Both operands are UTC midnights, so the gap is an exact whole number of
  // days in either direction — UTC has no DST, so a BST↔GMT boundary between
  // the two dates cannot shift it by an hour.
  const days = Math.round(
    (parsed.date.getTime() - currentDueUtcDay) / MS_PER_DAY
  )
  return {
    ok: true,
    value: `${pad(parsed.year, 4)}-${pad(parsed.month, 2)}-${pad(parsed.day, 2)}`,
    additionalDuration: isoDayDuration(days)
  }
}

/**
 * @param {{ extend?: Function, now?: () => Date }} [deps] `now` is the
 *   injectable clock, read once per submission. RA-611's corrected floor
 *   consults the current calendar year again, so the clock is back — and it
 *   matters more than it did in the first cut: without pinning it, every test
 *   of the 1-January bound would change behaviour on 1 January.
 */
export function createSlaService({ extend = defaultExtend, now } = {}) {
  const clock = now ?? (() => new Date())
  return {
    async extendSla({
      workItemId,
      reason,
      deadline,
      currentDueDate,
      slaStartedAt,
      user
    }) {
      const reasonValidation = validateReason(reason)
      if (!reasonValidation.ok) {
        return { ...reasonValidation, field: 'reason' }
      }
      const deadlineValidation = validateExtendDeadline(
        deadline,
        currentDueDate,
        { slaStartedAt, now: clock() }
      )
      if (!deadlineValidation.ok) {
        return deadlineValidation
      }

      const result = await extend({
        workItemId,
        reason: reasonValidation.reason,
        additionalDuration: deadlineValidation.additionalDuration,
        user
      })
      if (result.ok) {
        return { ok: true, workItem: result.workItem }
      }
      return {
        ok: false,
        outcome: result.reason ?? 'server',
        message: result.message
      }
    }
  }
}
