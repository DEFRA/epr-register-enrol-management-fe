/**
 * SLA extend/override service (RA-131).
 *
 * Two operations:
 *  - extendSla: validates reason + days → calls BE extend endpoint
 *  - overrideSla: validates reason + days + date → calls BE override endpoint
 *
 * Result shape: { ok: true, workItem } OR { ok: false, outcome, message }
 * Outcomes: 'invalid', 'forbidden', 'not-found', 'conflict', 'server', 'network'
 */

export const REASON_MAX_LENGTH = 500
export const MAX_DAYS = 31

async function defaultExtend(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.extendWorkItemSla(args)
}

async function defaultOverride(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.overrideWorkItemSla(args)
}

export function createSlaService({
  extend = defaultExtend,
  override = defaultOverride
} = {}) {
  return {
    async extendSla({ workItemId, reason, additionalDays, user }) {
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
      const days = Number(additionalDays)
      if (!Number.isInteger(days) || days < 1) {
        return {
          ok: false,
          outcome: 'invalid',
          message: 'Additional days must be a whole number of at least 1'
        }
      }
      if (days > MAX_DAYS) {
        return {
          ok: false,
          outcome: 'invalid',
          message: `Additional days must be ${MAX_DAYS} or fewer`
        }
      }
      const additionalDuration = `P${days}D`
      const result = await extend({
        workItemId,
        reason: trimmedReason,
        additionalDuration,
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
      const days = Number(newTargetDays)
      if (!Number.isInteger(days) || days < 1) {
        return {
          ok: false,
          outcome: 'invalid',
          message: 'Target duration must be a whole number of at least 1'
        }
      }
      const trimmedStartedAt =
        typeof newStartedAt === 'string' ? newStartedAt.trim() : ''
      if (!trimmedStartedAt) {
        return {
          ok: false,
          outcome: 'invalid',
          message: 'Start date is required'
        }
      }
      const startedAtDate = new Date(trimmedStartedAt)
      if (isNaN(startedAtDate.getTime())) {
        return {
          ok: false,
          outcome: 'invalid',
          message: 'Start date is not a valid date'
        }
      }
      const newTargetDuration = `P${days}D`
      const result = await override({
        workItemId,
        reason: trimmedReason,
        newTargetDuration,
        newStartedAt: startedAtDate.toISOString(),
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
