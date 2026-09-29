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
 * RA-611's floor changed MID-BRANCH. The first cut (commit ee15047) floored
 * the new deadline at TODAY, on the reasoning that a deadline already in the
 * past the moment it is saved is never what the regulator meant. The spec
 * that arrived on 29 Sep 2026 says otherwise: a determination may legitimately
 * be BACKDATED, as far back as the date the application became "duly made"
 * (the first date on which the regulator held all the required data and the
 * application charge was paid), but never before 1 January of the
 * accreditation year. The today-floor is therefore REPLACED, not
 * supplemented — keeping it would make the real rule unreachable, because
 * every date it permits is already at or after today.
 *
 * The floor is now the LATER of:
 *   (a) the SLA clock's start date (`slaStartedAt`) — the duly-made anchor;
 *   (b) 1 January of the payload's `accreditationYear`.
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
 * RA-611's first cut used this to resolve "today". The 29 Sep 2026 spec
 * removed "today" from the rule, but the zone handling is still needed — now
 * for the duly-made ANCHOR, which is an instant and not a date. Items made
 * duly by `dulyMake` carry a midnight-UTC anchor, where the UTC and London
 * calendar dates always agree; but the backfill migration and the seeder in
 * management-be stamp `StartedAt` from a real timestamp, and for those the two
 * readings can differ by a day: 23:30Z on 15 June is 00:30 on 16 June in
 * London during BST. Where they differ, London is the right answer — the
 * regulator types a UK calendar date into the day/month/year boxes, and
 * management-be floors on the London date too, so reading the anchor in UTC
 * here would let the FE name a floor date the backend then rejects with a 422
 * the caseworker could not satisfy.
 */
function ukCalendarDayOf(instant) {
  const parts = Object.fromEntries(
    ukDateFormatter
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  )
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  )
}

/**
 * RA-611 (29 Sep 2026 spec). The lower bound the new deadline may not fall
 * below, and the message naming whichever bound produced it.
 *
 * Two candidates, of which the LATER wins:
 *
 *  (a) The duly-made anchor: the UK calendar date of the SLA clock's start.
 *      management-be stamps `slaStartedAt` when the application became duly
 *      made, so it IS the "first date on which the regulator had all the data
 *      and the charge was paid" the spec names.
 *  (b) 1 January of the accreditation year, which the spec makes an absolute
 *      backstop: a determination is never backdated into the previous
 *      accreditation year, even if the application was duly made before the
 *      year began. This one needs no timezone handling — it is already a
 *      calendar date rather than an instant.
 *
 * `accreditationYear` missing or not a number — or a year outside the range a
 * date can represent — falls back to (a) ALONE. The current year is
 * deliberately NOT substituted: inventing a bound the payload did not state
 * could refuse a backdate the spec permits on a work item whose year we merely
 * failed to read. management-be does exactly the same (confirmed on this
 * branch). The `typeof … === 'number'` test is the idiom already used for
 * this field in `re-accreditation-decision-metadata.js`.
 *
 * Ties go to the 1-January wording: when the application was duly made on
 * 1 January itself both bounds name the same day, and the year bound is the
 * clearer thing to tell the caseworker. management-be tie-breaks the same way.
 *
 * @param {Date} startedAt the SLA clock's start instant
 * @param {number|null|undefined} accreditationYear
 * @returns {{ floor: number, message: string }}
 */
function deadlineFloor(startedAt, accreditationYear) {
  const dulyMadeFloor = ukCalendarDayOf(startedAt)
  const yearFloor =
    typeof accreditationYear === 'number' && Number.isFinite(accreditationYear)
      ? Date.UTC(accreditationYear, 0, 1)
      : null

  if (yearFloor !== null && yearFloor >= dulyMadeFloor) {
    return {
      floor: yearFloor,
      message: `The new determination deadline cannot be earlier than 1 January ${accreditationYear}`
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
 * the accreditation year. Landing exactly ON the floor is accepted.
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
 * @param {{ slaStartedAt?: string|null, accreditationYear?: number|null }}
 *   [bounds] the two inputs the RA-611 floor is built from: the SLA clock's
 *   start date (the duly-made anchor) and the payload's accreditation year.
 *   Both come straight off the work item the controller already loaded.
 * @returns {{ ok: true, value: string, additionalDuration: string } |
 *   { ok: false, outcome: 'invalid', field: 'deadline', message: string }}
 */
export function validateExtendDeadline(
  deadline,
  currentDueDate,
  { slaStartedAt, accreditationYear } = {}
) {
  const day = textOf(deadline?.day)
  const month = textOf(deadline?.month)
  const year = textOf(deadline?.year)
  const invalid = (message) => ({
    ok: false,
    outcome: 'invalid',
    field: 'deadline',
    message
  })

  if (day === '' && month === '' && year === '') {
    return invalid('Enter the new determination deadline')
  }

  const parsed = parseCalendarDate(day, month, year)
  if (!parsed) {
    return invalid('Determination deadline must be a real date')
  }

  // The SLA clock is the source of BOTH date rules' inputs: management-be
  // projects `slaDueDate` and `slaStartedAt` off the same clock object, so one
  // is null exactly when the other is (confirmed with management-be on this
  // branch). A work item with no clock has no deadline to change and no
  // duly-made anchor to floor a new one at, which is one condition and gets
  // one message — rather than silently dropping the floor and letting an
  // unbounded backdate through to a backend that would reject it.
  const currentDue = currentDueDate ? new Date(currentDueDate) : null
  const startedAt = slaStartedAt ? new Date(slaStartedAt) : null
  if (
    !currentDue ||
    Number.isNaN(currentDue.getTime()) ||
    !startedAt ||
    Number.isNaN(startedAt.getTime())
  ) {
    return invalid('This application has no determination deadline to change')
  }
  const currentDueUtcDay = startOfUtcDay(currentDue)

  // RA-611: the floor, checked before the no-op rule — a date below the floor
  // is the more specific and more actionable problem to report, even when it
  // happens to equal the current deadline. Landing exactly ON the floor is
  // accepted, so the comparison is strictly-below.
  const bound = deadlineFloor(startedAt, accreditationYear)
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
 * @param {{ extend?: Function }} [deps] The injectable clock the first cut of
 *   RA-611 needed is gone: the 29 Sep 2026 floor is built from the work item's
 *   own dates, so nothing here reads the current time and there is no clock
 *   left to pin.
 */
export function createSlaService({ extend = defaultExtend } = {}) {
  return {
    async extendSla({
      workItemId,
      reason,
      deadline,
      currentDueDate,
      slaStartedAt,
      accreditationYear,
      user
    }) {
      const reasonValidation = validateReason(reason)
      if (!reasonValidation.ok) {
        return { ...reasonValidation, field: 'reason' }
      }
      const deadlineValidation = validateExtendDeadline(
        deadline,
        currentDueDate,
        { slaStartedAt, accreditationYear }
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
