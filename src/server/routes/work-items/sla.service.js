/**
 * Determination-deadline change service (RA-131, reworked by RA-447 CM6,
 * RA-601 and RA-611).
 *
 * One operation, `extendSla`: validates reason + a new deadline date → calls
 * the BE extend endpoint. There is no upper bound (RA-447 CM6). RA-601
 * removed the "later than the current deadline" rule, so the deadline may be
 * brought forward as well as pushed back; RA-611 then put a FLOOR back under
 * it — the new deadline may not fall earlier than today (in UK local time),
 * because a determination deadline that has already passed the moment it is
 * saved is never what the regulator meant. Today itself is allowed.
 *
 * So the two surviving date rules are: not earlier than today, and different
 * from the current deadline.
 *
 * RA-572 removed the sibling `overrideSla` operation and its validation
 * along with the Override journey. The method name and the BE endpoint it
 * wraps are unchanged: only the user-facing copy became "change" wording.
 *
 * Result shape: { ok: true, workItem } OR { ok: false, outcome, message }
 * Outcomes: 'invalid', 'forbidden', 'not-found', 'conflict', 'server', 'network'
 */

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
 * RA-601 allows the deadline to move backwards (to a date that is still
 * today or later — see RA-611), which makes `days` negative. ISO-8601 puts
 * the sign AHEAD of the `P` designator — `-P5D`, never `P-5D`, which is
 * malformed and would be rejected or mis-parsed by the backend.
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
 * RA-611. "Today" as the regulator sees it: the UK-local calendar date of
 * `now`, returned as the UTC midnight of that date so it is directly
 * comparable with the values `parseCalendarDate` produces.
 *
 * Comparing against the UTC day would be wrong for the hour after midnight
 * during BST, when the UK is a calendar day ahead of UTC: at 00:30 on
 * 12 September UK time it is still 23:30 on 11 September in UTC, so a UTC
 * floor would accept 11 September — a date the regulator sees as yesterday.
 */
function startOfUkDay(now) {
  const parts = Object.fromEntries(
    ukDateFormatter.formatToParts(now).map((part) => [part.type, part.value])
  )
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  )
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
 * push it back. RA-611 reverses the part of that decision that had no floor.
 * A deadline earlier than TODAY is now rejected — it would be overdue the
 * instant it was saved — while today itself is accepted, and a backwards
 * move onto any date from today onwards is still perfectly legitimate.
 *
 * Two date rules therefore survive, checked in this order after the shape
 * checks (empty, then not-a-real-date):
 *   1. not earlier than today (RA-611), "today" being the UK-local calendar
 *      date so the boundary matches the regulator's own clock rather than
 *      UTC's — see `startOfUkDay`;
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
 * @param {{ now?: Date }} [options] injectable clock — the instant "today"
 *   is derived from. Defaults to the real current time; tests pass a fixed
 *   Date so the today-boundary cases are deterministic.
 * @returns {{ ok: true, value: string, additionalDuration: string } |
 *   { ok: false, outcome: 'invalid', field: 'deadline', message: string }}
 */
export function validateExtendDeadline(
  deadline,
  currentDueDate,
  { now = new Date() } = {}
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

  // RA-611: the floor. A deadline earlier than today would be overdue the
  // moment it was saved, so it is rejected before the no-op check — a past
  // date is the more specific and more actionable problem to report, even
  // when it happens to equal the current deadline.
  if (parsed.date.getTime() < startOfUkDay(now)) {
    return invalid(
      'The new determination deadline cannot be earlier than today'
    )
  }

  const currentDue = currentDueDate ? new Date(currentDueDate) : null
  if (!currentDue || Number.isNaN(currentDue.getTime())) {
    return invalid('This application has no determination deadline to change')
  }
  const currentDueUtcDay = startOfUtcDay(currentDue)

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
 *   injectable clock RA-611's "not earlier than today" rule is measured
 *   against; tests pin it so the boundary cases never depend on the real date.
 */
export function createSlaService({ extend = defaultExtend, now } = {}) {
  const clock = now ?? (() => new Date())
  return {
    async extendSla({ workItemId, reason, deadline, currentDueDate, user }) {
      const reasonValidation = validateReason(reason)
      if (!reasonValidation.ok) {
        return { ...reasonValidation, field: 'reason' }
      }
      const deadlineValidation = validateExtendDeadline(
        deadline,
        currentDueDate,
        { now: clock() }
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
