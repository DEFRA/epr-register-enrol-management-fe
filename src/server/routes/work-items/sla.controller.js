/**
 * SLA extend and override controllers (RA-131).
 */

import { getUser, hasRole } from '#/server/common/helpers/auth/get-user.js'
import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { REASON_MAX_LENGTH, createSlaService } from './sla.service.js'
import { ROLE_TEAM_LEADER } from '#/server/common/helpers/auth/auth-scopes.js'
import { config } from '#/config/config.js'

const EXTEND_VIEW = 'work-items/sla-extend'
const OVERRIDE_VIEW = 'work-items/sla-override'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

function breadcrumbs(id, action, ref) {
  return [
    { text: 'Work items', href: '/work-items' },
    { text: ref ?? 'Work item', href: detailHref(id) },
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
      const user = getUser(request)
      const result = await getWorkItem({ workItemId: id, user })

      if (result.ok === false && result.status === 404) {
        return h
          .view(NOT_FOUND_VIEW, {
            pageTitle: 'Work item not found',
            heading: 'Work item not found',
            workItemId: id,
            breadcrumbs: [
              { text: 'Work items', href: '/work-items' },
              { text: 'Not found' }
            ]
          })
          .code(404)
      }

      if (!result.ok) {
        return h
          .view(UNAVAILABLE_VIEW, {
            pageTitle: 'Work item unavailable',
            heading: 'Work item unavailable',
            workItemId: id,
            error: result.error ?? `Backend returned ${result.status}`,
            breadcrumbs: [
              { text: 'Work items', href: '/work-items' },
              { text: 'Work item' }
            ]
          })
          .code(502)
      }

      const workItem = result.workItem
      const applicationRef = workItem.payload.applicationReference
      const maxDays = config.get('workItems.sla.maxExtensionDays')
      return h.view(EXTEND_VIEW, {
        pageTitle: 'Extend SLA',
        heading: 'Extend SLA',
        breadcrumbs: breadcrumbs(id, 'Extend SLA', applicationRef),
        workItem: { ...workItem, applicationRef },
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

export function makeSubmitExtendController({
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
      const maxDays = config.get('workItems.sla.maxExtensionDays')

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
        const itemResult = await getWorkItem({ workItemId: id, user })
        const applicationRef = itemResult.ok
          ? itemResult.workItem.payload.applicationReference
          : null
        return h
          .view(EXTEND_VIEW, {
            pageTitle: 'Error: Extend SLA',
            heading: 'Extend SLA',
            breadcrumbs: breadcrumbs(id, 'Extend SLA', applicationRef),
            workItem: { id, applicationRef },
            formAction: `/work-items/${encodeURIComponent(id)}/sla/extend`,
            cancelHref: detailHref(id),
            reasonMaxLength: REASON_MAX_LENGTH,
            maxDays,
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
      if (!hasRole(request, ROLE_TEAM_LEADER)) {
        return h.response('Forbidden').code(403)
      }
      const id = request.params.id
      const user = getUser(request)
      const result = await getWorkItem({ workItemId: id, user })

      if (result.ok === false && result.status === 404) {
        return h
          .view(NOT_FOUND_VIEW, {
            pageTitle: 'Work item not found',
            heading: 'Work item not found',
            workItemId: id,
            breadcrumbs: [
              { text: 'Work items', href: '/work-items' },
              { text: 'Not found' }
            ]
          })
          .code(404)
      }

      if (!result.ok) {
        return h
          .view(UNAVAILABLE_VIEW, {
            pageTitle: 'Work item unavailable',
            heading: 'Work item unavailable',
            workItemId: id,
            error: result.error ?? `Backend returned ${result.status}`,
            breadcrumbs: [
              { text: 'Work items', href: '/work-items' },
              { text: 'Work item' }
            ]
          })
          .code(502)
      }

      const workItem = result.workItem
      const applicationRef = workItem.payload.applicationReference
      return h.view(OVERRIDE_VIEW, {
        pageTitle: 'Override SLA',
        heading: 'Override SLA',
        breadcrumbs: breadcrumbs(id, 'Override SLA', applicationRef),
        workItem: { ...workItem, applicationRef },
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
        const itemResult = await getWorkItem({ workItemId: id, user })
        const applicationRef = itemResult.ok
          ? itemResult.workItem.payload.applicationReference
          : null
        return h
          .view(OVERRIDE_VIEW, {
            pageTitle: 'Error: Override SLA',
            heading: 'Override SLA',
            breadcrumbs: breadcrumbs(id, 'Override SLA', applicationRef),
            workItem: { id, applicationRef },
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
  const title = `Could not ${action} SLA`
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title,
      text: 'The work item state changed. Refresh and try again.'
    }
  }
  if (result.outcome === 'forbidden') {
    return {
      type: 'error',
      title,
      text: 'You do not have permission to perform this action.'
    }
  }
  if (result.outcome === 'not-found') {
    return {
      type: 'error',
      title,
      text: 'The work item could not be found.'
    }
  }

  return {
    type: 'error',
    title: 'Action failed',
    text: result.message ?? 'The SLA could not be updated.'
  }
}
