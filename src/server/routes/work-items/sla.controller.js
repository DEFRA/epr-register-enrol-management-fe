/**
 * SLA extend and override controllers (RA-131).
 *
 * Extend flow is a two-step "input → confirm → apply" wizard so the team
 * leader can review what they are about to change before it hits the
 * backend (RA-131 update, May 26). GOV.UK Design System has no modal
 * component, so the previous in-page `<dialog>` (which was silently
 * blocked by CSP anyway) is replaced with two plain server-rendered
 * pages. Both pages live under `/work-items/{id}/sla/extend...` so the
 * URL space stays aligned with the backend endpoint.
 *
 *  - GET  /work-items/{id}/sla/extend          — render input form
 *  - POST /work-items/{id}/sla/extend          — validate → render confirm
 *  - POST /work-items/{id}/sla/extend/confirm  — apply via backend
 *  - GET  /work-items/{id}/sla/override        — render override form
 *  - POST /work-items/{id}/sla/override        — submit override
 *
 * All paths PRG-redirect back to the work item detail with a flash
 * banner on success / non-validation failure.
 */

import { getUser, hasRole } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import {
  REASON_MAX_LENGTH,
  createSlaService,
  validateExtendInput
} from './sla.service.js'
import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { ROLE_TEAM_LEADER } from '#/server/common/helpers/auth/auth-scopes.js'
import { config } from '#/config/config.js'

const EXTEND_VIEW = 'work-items/sla-extend'
const EXTEND_CONFIRM_VIEW = 'work-items/sla-extend-confirm'
const OVERRIDE_VIEW = 'work-items/sla-override'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

function breadcrumbs(id, action) {
  return [
    { text: 'Home', href: '/' },
    { text: 'Work items', href: '/work-items' },
    { text: id, href: detailHref(id) },
    { text: action }
  ]
}

export function makeShowExtendController() {
  return {
    async handler(request, h) {
      if (!hasRole(request, ROLE_TEAM_LEADER)) {
        return h.response('Forbidden').code(403)
      }
      const id = request.params.id
      const maxDays = config.get('workItems.sla.maxExtensionDays')
      return h.view(EXTEND_VIEW, {
        pageTitle: 'Extend SLA',
        heading: 'Extend SLA',
        breadcrumbs: breadcrumbs(id, 'Extend SLA'),
        workItem: { id },
        formAction: `/work-items/${encodeURIComponent(id)}/sla/extend`,
        cancelHref: detailHref(id),
        reasonMaxLength: REASON_MAX_LENGTH,
        maxDays,
        values: { reason: '', additionalDays: '' },
        errorSummary: null,
        fieldErrors: {}
      })
    }
  }
}

export function makeSubmitExtendController() {
  return {
    async handler(request, h) {
      if (!hasRole(request, ROLE_TEAM_LEADER)) {
        return h.response('Forbidden').code(403)
      }
      const id = request.params.id
      const user = getUser(request)
      const payload = request.payload ?? {}
      const reason = typeof payload.reason === 'string' ? payload.reason : ''
      const additionalDays =
        typeof payload.additionalDays === 'string' ? payload.additionalDays : ''
      const maxDays = config.get('workItems.sla.maxExtensionDays')

      const validation = validateExtendInput({
        reason,
        additionalDays,
        maxDays
      })

      if (!validation.ok) {
        return h
          .view(EXTEND_VIEW, {
            pageTitle: 'Error: Extend SLA',
            heading: 'Extend SLA',
            breadcrumbs: breadcrumbs(id, 'Extend SLA'),
            workItem: { id },
            formAction: `/work-items/${encodeURIComponent(id)}/sla/extend`,
            cancelHref: detailHref(id),
            reasonMaxLength: REASON_MAX_LENGTH,
            maxDays,
            values: { reason, additionalDays },
            errorSummary: {
              titleText: 'There is a problem',
              items: [{ text: validation.message, href: '#field-reason' }]
            },
            fieldErrors: { reason: validation.message }
          })
          .code(400)
      }

      // Best-effort lookup of the current SLA clock so we can show the
      // user what the new due date will be on the confirmation page. If
      // the backend is unavailable we still render the confirmation page
      // (the user can confirm or cancel) but suppress the date preview.
      const { days, reason: trimmedReason } = validation.normalised
      const newDueAt = await computeNewDueAt({ id, user, additionalDays: days })

      return h.view(EXTEND_CONFIRM_VIEW, {
        pageTitle: 'Confirm extend SLA',
        heading: 'Confirm extend SLA',
        breadcrumbs: breadcrumbs(id, 'Confirm extend SLA'),
        workItem: { id },
        formAction: `/work-items/${encodeURIComponent(id)}/sla/extend/confirm`,
        backHref: `/work-items/${encodeURIComponent(id)}/sla/extend`,
        cancelHref: detailHref(id),
        values: { reason: trimmedReason, additionalDays: String(days) },
        additionalDays: days,
        newDueAt
      })
    }
  }
}

export function makeConfirmExtendController({
  service = createSlaService()
} = {}) {
  return {
    async handler(request, h) {
      if (!hasRole(request, ROLE_TEAM_LEADER)) {
        return h.response('Forbidden').code(403)
      }
      const id = request.params.id
      const user = getUser(request)
      const payload = request.payload ?? {}
      const reason = typeof payload.reason === 'string' ? payload.reason : ''
      const additionalDays =
        typeof payload.additionalDays === 'string' ? payload.additionalDays : ''

      const result = await service.extendSla({
        workItemId: id,
        reason,
        additionalDays,
        user
      })

      if (result.ok) {
        flashBanner(request, {
          type: 'success',
          title: 'SLA extended',
          text: 'The SLA deadline has been extended.'
        })
        return h.redirect(detailHref(id))
      }

      // If the hidden-field values were tampered with after confirmation
      // they could fail re-validation; bounce the user back to the input
      // form with the error summary rather than to a generic banner.
      if (result.outcome === 'invalid') {
        return h
          .view(EXTEND_VIEW, {
            pageTitle: 'Error: Extend SLA',
            heading: 'Extend SLA',
            breadcrumbs: breadcrumbs(id, 'Extend SLA'),
            workItem: { id },
            formAction: `/work-items/${encodeURIComponent(id)}/sla/extend`,
            cancelHref: detailHref(id),
            reasonMaxLength: REASON_MAX_LENGTH,
            maxDays: config.get('workItems.sla.maxExtensionDays'),
            values: { reason, additionalDays },
            errorSummary: {
              titleText: 'There is a problem',
              items: [{ text: result.message, href: '#field-reason' }]
            },
            fieldErrors: { reason: result.message }
          })
          .code(400)
      }

      logger.warn(
        { workItemId: id, outcome: result.outcome, message: result.message },
        'SLA extend failed'
      )
      flashBanner(request, bannerForSlaFailure(result, 'extend'))
      return h.redirect(detailHref(id))
    }
  }
}

/**
 * Compute the projected new SLA due date for the confirmation page.
 * Returns an ISO date string, or `null` when the backend doesn't expose
 * an SLA clock (e.g. types without an SLA, missing API, transport
 * failure). Best-effort: the backend remains the source of truth at
 * confirm time.
 */
async function computeNewDueAt({ id, user, additionalDays }) {
  try {
    const result = await getWorkItem({ workItemId: id, user })
    if (!result.ok) return null
    const remainingDays = parseDotNetTimeSpanDays(result.workItem?.slaRemaining)
    if (remainingDays === null) return null
    const due = new Date()
    due.setUTCHours(0, 0, 0, 0)
    due.setUTCDate(due.getUTCDate() + remainingDays + additionalDays)
    return due.toISOString()
  } catch (err) {
    logger.warn(
      { err, workItemId: id },
      'Could not compute new SLA due date for confirmation page'
    )
    return null
  }
}

/**
 * Parse the integer day count from a .NET "c" format TimeSpan string.
 * Format: [-][d.]hh:mm:ss[.fraction]  e.g. "84.00:00:00", "14.12:30:00".
 * Returns null when the value is absent or not parseable.
 *
 * Duplicated from `controller.js` to keep the SLA flow self-contained;
 * if a third caller appears, hoist into a shared helper.
 */
function parseDotNetTimeSpanDays(value) {
  if (!value || typeof value !== 'string') return null
  const negative = value.startsWith('-')
  const s = negative ? value.slice(1) : value
  const dotIdx = s.indexOf('.')
  const colonIdx = s.indexOf(':')
  if (dotIdx !== -1 && (colonIdx === -1 || dotIdx < colonIdx)) {
    const days = parseInt(s.slice(0, dotIdx), 10)
    if (Number.isNaN(days)) return null
    return negative ? -days : days
  }
  return 0
}

export function makeShowOverrideController() {
  return {
    async handler(request, h) {
      if (!hasRole(request, ROLE_TEAM_LEADER)) {
        return h.response('Forbidden').code(403)
      }
      const id = request.params.id
      return h.view(OVERRIDE_VIEW, {
        pageTitle: 'Override SLA',
        heading: 'Override SLA',
        breadcrumbs: breadcrumbs(id, 'Override SLA'),
        workItem: { id },
        formAction: `/work-items/${encodeURIComponent(id)}/sla/override`,
        cancelHref: detailHref(id),
        reasonMaxLength: REASON_MAX_LENGTH,
        values: { reason: '', newTargetDays: '', newStartedAt: '' },
        errorSummary: null,
        fieldErrors: {}
      })
    }
  }
}

export function makeSubmitOverrideController({
  service = createSlaService()
} = {}) {
  return {
    async handler(request, h) {
      if (!hasRole(request, ROLE_TEAM_LEADER)) {
        return h.response('Forbidden').code(403)
      }
      const id = request.params.id
      const user = getUser(request)
      const payload = request.payload ?? {}
      const reason = typeof payload.reason === 'string' ? payload.reason : ''
      const newTargetDays =
        typeof payload.newTargetDays === 'string' ? payload.newTargetDays : ''
      const newStartedAt =
        typeof payload.newStartedAt === 'string' ? payload.newStartedAt : ''

      const result = await service.overrideSla({
        workItemId: id,
        reason,
        newTargetDays,
        newStartedAt,
        user
      })

      if (result.ok) {
        flashBanner(request, {
          type: 'success',
          title: 'SLA overridden',
          text: 'The SLA clock has been overridden.'
        })
        return h.redirect(detailHref(id))
      }

      if (result.outcome === 'invalid') {
        return h
          .view(OVERRIDE_VIEW, {
            pageTitle: 'Error: Override SLA',
            heading: 'Override SLA',
            breadcrumbs: breadcrumbs(id, 'Override SLA'),
            workItem: { id },
            formAction: `/work-items/${encodeURIComponent(id)}/sla/override`,
            cancelHref: detailHref(id),
            reasonMaxLength: REASON_MAX_LENGTH,
            values: { reason, newTargetDays, newStartedAt },
            errorSummary: {
              titleText: 'There is a problem',
              items: [{ text: result.message, href: '#field-reason' }]
            },
            fieldErrors: { reason: result.message }
          })
          .code(400)
      }

      logger.warn(
        { workItemId: id, outcome: result.outcome, message: result.message },
        'SLA override failed'
      )
      flashBanner(request, bannerForSlaFailure(result, 'override'))
      return h.redirect(detailHref(id))
    }
  }
}

function bannerForSlaFailure(result, action) {
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title: `Could not ${action} SLA`,
      text: 'Someone else updated this case. Refresh and try again.'
    }
  }
  if (result.outcome === 'forbidden') {
    return {
      type: 'error',
      title: `Could not ${action} SLA`,
      text: 'You do not have permission to perform this action.'
    }
  }
  if (result.outcome === 'not-found') {
    return {
      type: 'error',
      title: 'Work item not found',
      text: 'This work item could not be found.'
    }
  }
  return {
    type: 'error',
    title: `Could not ${action} SLA`,
    text: 'There was a problem. Try again.'
  }
}
