/**
 * SLA extend and override controllers (RA-131).
 *
 * Four handlers:
 *  - GET  /work-items/{id}/sla/extend   — render extend form
 *  - POST /work-items/{id}/sla/extend   — submit extend
 *  - GET  /work-items/{id}/sla/override — render override form
 *  - POST /work-items/{id}/sla/override — submit override
 *
 * Both flows use PRG — redirect back to work item detail with flash banner.
 */

import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { REASON_MAX_LENGTH, MAX_DAYS, createSlaService } from './sla.service.js'

const EXTEND_VIEW = 'work-items/sla-extend'
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
      const id = request.params.id
      return h.view(EXTEND_VIEW, {
        pageTitle: 'Extend SLA',
        heading: 'Extend SLA',
        breadcrumbs: breadcrumbs(id, 'Extend SLA'),
        workItem: { id },
        formAction: `/work-items/${encodeURIComponent(id)}/sla/extend`,
        cancelHref: detailHref(id),
        reasonMaxLength: REASON_MAX_LENGTH,
        maxDays: MAX_DAYS,
        values: { reason: '', additionalDays: '' },
        errorSummary: null,
        fieldErrors: {}
      })
    }
  }
}

export function makeSubmitExtendController({
  service = createSlaService()
} = {}) {
  return {
    async handler(request, h) {
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
            maxDays: MAX_DAYS,
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

export function makeShowOverrideController() {
  return {
    async handler(request, h) {
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
