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

import { config } from '#/config/config.js'

export const REASON_MAX_LENGTH = 500

async function defaultExtend(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.extendWorkItemSla(args)
}

async function defaultOverride(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.overrideWorkItemSla(args)
}

/**
 * Pure validator for the extend-SLA form inputs. Split out from
 * `extendSla` so the confirmation flow (RA-131) can validate without
 * calling the backend on the first POST step.
 *
 * Returns `{ ok: true, normalised: { reason, days, additionalDuration } }`
 * or `{ ok: false, outcome: 'invalid', message }`.
 */
export function validateExtendInput({
  reason,
  additionalDays,
  maxDays = config.get('workItems.sla.maxExtensionDays')
} = {}) {
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
  if (days > maxDays) {
    return {
      ok: false,
      outcome: 'invalid',
      message: `Additional days must be ${maxDays} or fewer`
    }
  }
  return {
    ok: true,
    normalised: {
      reason: trimmedReason,
      days,
      additionalDuration: `P${days}D`
    }
  }
}

export function createSlaService({
  extend = defaultExtend,
  override = defaultOverride,
  maxDays = config.get('workItems.sla.maxExtensionDays')
} = {}) {
  return {
    async extendSla({ workItemId, reason, additionalDays, user }) {
      const validation = validateExtendInput({
        reason,
        additionalDays,
        maxDays
      })
      if (!validation.ok) return validation
      const { reason: trimmedReason, additionalDuration } =
        validation.normalised
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
        reason: trimmedReason,
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
