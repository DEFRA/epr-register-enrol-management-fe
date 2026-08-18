/**
 * SLA extend/override service (RA-131, extend reworked by RA-447 CM6).
 *
 * Two operations:
 *  - extendSla: validates reason + a new deadline date → calls BE extend
 *    endpoint. There is no upper bound on the extension (RA-447 CM6) — the
 *    only constraint is that the new deadline is strictly after the current
 *    one.
 *  - overrideSla: validates reason + days + date → calls BE override
 *    endpoint. Unchanged by RA-447.
 *
 * Result shape: { ok: true, workItem } OR { ok: false, outcome, message }
 * Outcomes: 'invalid', 'forbidden', 'not-found', 'conflict', 'server', 'network'
 */

export const REASON_MAX_LENGTH = 500

async function defaultExtend(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.extendWorkItemSla(args)
}

async function defaultOverride(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.overrideWorkItemSla(args)
}

/** Shared reason validation for both extend and override. */
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

/**
 * Pure validator for the extend-SLA form's new-deadline date input.
 *
 * RA-447 CM6 replaced the "number of additional days" input (capped by
 * `workItems.sla.maxExtensionDays`) with a `govukDateInput` for the new
 * determination deadline, and dropped the cap entirely — the only rule left
 * is that the new deadline must be an EXTENSION, never a reduction, so it
 * must fall strictly after the work item's current `slaDueDate`.
 *
 * The day-count the backend's wire contract still expects
 * (`additionalDuration`, an ISO-8601 duration) is derived here from the gap
 * between the two dates, so the API contract is unchanged even though the
 * user no longer types a day count directly.
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
  if (
    !/^\d{1,2}$/.test(day) ||
    !/^\d{1,2}$/.test(month) ||
    !/^\d{4}$/.test(year)
  ) {
    return invalid('Determination deadline must be a real date')
  }

  const d = Number(day)
  const m = Number(month)
  const y = Number(year)
  const asUtc = new Date(Date.UTC(y, m - 1, d))
  // Round-trip check — `Date.UTC` rolls an unreal date (e.g. 2026-02-30)
  // forward rather than rejecting it, so the parts are compared back.
  if (
    asUtc.getUTCFullYear() !== y ||
    asUtc.getUTCMonth() !== m - 1 ||
    asUtc.getUTCDate() !== d
  ) {
    return invalid('Determination deadline must be a real date')
  }

  const currentDue = currentDueDate ? new Date(currentDueDate) : null
  if (!currentDue || isNaN(currentDue.getTime())) {
    return invalid('This application has no determination deadline to extend')
  }
  const currentDueUtcDay = startOfUtcDay(currentDue)

  // EXTENSION ONLY (RA-447 CM6). Strictly after, not on-or-after, so
  // resubmitting the current deadline is rejected as a no-op rather than
  // silently accepted as a zero-day "extension".
  if (asUtc.getTime() <= currentDueUtcDay) {
    return invalid(
      'The new determination deadline must be after the current deadline'
    )
  }

  const days = Math.round((asUtc.getTime() - currentDueUtcDay) / 86400000)
  return {
    ok: true,
    value: `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`,
    additionalDuration: `P${days}D`
  }
}

export function createSlaService({
  extend = defaultExtend,
  override = defaultOverride
} = {}) {
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
      if (!deadlineValidation.ok) return deadlineValidation

      const result = await extend({
        workItemId,
        reason: reasonValidation.reason,
        additionalDuration: deadlineValidation.additionalDuration,
        user
      })
      if (result.ok) return { ok: true, workItem: result.workItem }
      return {
        ok: false,
        outcome: result.reason ?? 'server',
        message: result.message
      }
    },

    async overrideSla({
      workItemId,
      reason,
      newTargetDays,
      newStartedAt,
      user
    }) {
      const reasonValidation = validateReason(reason)
      if (!reasonValidation.ok) return reasonValidation

      const days = Number(newTargetDays)
      if (!Number.isInteger(days) || days < 1) {
        return {
          ok: false,
          outcome: 'invalid',
          message: 'Target duration must be a whole number of at least 1'
        }
      }
      // newStartedAt is optional: when omitted the BE defaults to today
      // (BA confirmed RA-131).
      const trimmedStartedAt =
        typeof newStartedAt === 'string' ? newStartedAt.trim() : ''
      let resolvedStartedAt
      if (trimmedStartedAt) {
        const startedAtDate = new Date(trimmedStartedAt)
        if (isNaN(startedAtDate.getTime())) {
          return {
            ok: false,
            outcome: 'invalid',
            message: 'Start date is not a valid date'
          }
        }
        resolvedStartedAt = startedAtDate.toISOString()
      }
      const newTargetDuration = `P${days}D`
      const result = await override({
        workItemId,
        reason: reasonValidation.reason,
        newTargetDuration,
        ...(resolvedStartedAt !== undefined
          ? { newStartedAt: resolvedStartedAt }
          : {}),
        user
      })
      if (result.ok) return { ok: true, workItem: result.workItem }
      return {
        ok: false,
        outcome: result.reason ?? 'server',
        message: result.message
      }
    }
  }
}
