/**
 * Determination-deadline change service (RA-131, reworked by RA-447 CM6 and
 * RA-601).
 *
 * One operation, `extendSla`: validates reason + a new deadline date → calls
 * the BE extend endpoint. There is no upper bound (RA-447 CM6) and, since
 * RA-601, no lower bound either — the only constraint on the date is that it
 * differs from the current deadline.
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
 * RA-601 allows the deadline to move backwards, which makes `days` negative.
 * ISO-8601 puts the sign AHEAD of the `P` designator — `-P5D`, never `P-5D`,
 * which is malformed and would be rejected or mis-parsed by the backend.
 */
function isoDayDuration(days) {
  return days < 0 ? `-P${Math.abs(days)}D` : `P${days}D`
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
 * RA-601 removed the remaining direction rule. The new deadline may now fall
 * BEFORE the current one: a regulator can advance a determination deadline as
 * well as push it back. There is deliberately no floor — a date earlier than
 * today, or earlier than the SLA clock's `startedAt`, is accepted. The only
 * surviving date rule is that the new deadline must differ from the current
 * one, because resubmitting the same date is a no-op rather than a change.
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
 * @returns {{ ok: true, additionalDuration: string } |
 *   { ok: false, outcome: 'invalid', field: 'deadline', message: string }}
 */
export function validateExtendDeadline(deadline, currentDueDate) {
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

  const currentDue = currentDueDate ? new Date(currentDueDate) : null
  if (!currentDue || Number.isNaN(currentDue.getTime())) {
    return invalid('This application has no determination deadline to change')
  }
  const currentDueUtcDay = startOfUtcDay(currentDue)

  // RA-601: either direction is allowed, so the only date rule left is that
  // something actually changes. Equality is the no-op — it would otherwise be
  // submitted to the backend as a zero-day change and recorded in the audit
  // log as a deadline change that moved nothing.
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

export function createSlaService({ extend = defaultExtend } = {}) {
  return {
    async extendSla({ workItemId, reason, deadline, currentDueDate, user }) {
      const reasonValidation = validateReason(reason)
      if (!reasonValidation.ok) {
        return { ...reasonValidation, field: 'reason' }
      }
      const deadlineValidation = validateExtendDeadline(
        deadline,
        currentDueDate
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
