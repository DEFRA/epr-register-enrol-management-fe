/**
 * SLA extend and override controllers (RA-131), both relabelled from "SLA"
 * to "Determination Deadline" by RA-447. Extend also got behavioural
 * changes: CM6 replaced the day-count input with a calendar date picker and
 * removed the extension cap. Override (CM9) is a pure wording change — its
 * validation, wire contract and `OverrideAsync` audit string are untouched.
 */

import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { REASON_MAX_LENGTH, createSlaService } from './sla.service.js'

const EXTEND_VIEW = 'work-items/sla-extend'
const OVERRIDE_VIEW = 'work-items/sla-override'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

// RA-447 CM6. The `govukDateInput` id / name prefix for the new
// determination deadline, and the error-summary anchor (the DAY box, so
// focus lands on the first field of the group).
const EXTEND_DEADLINE_ID = 'new-deadline'
const EXTEND_DEADLINE_ANCHOR = `#${EXTEND_DEADLINE_ID}-day`

const EXTEND_HEADING = 'Extend determination deadline'
// RA-447 CM9. This single constant drives pageTitle/heading/breadcrumb on
// both the GET and the validation-error re-render.
const OVERRIDE_HEADING = 'Override determination deadline'

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

/**
 * Fetch the work item for the extend flow, or the not-found / unavailable
 * view when that fails. Shared between the GET and POST handlers because
 * RA-447 CM6 needs the work item's CURRENT `slaDueDate` on submit too — the
 * new deadline can only be validated as a genuine extension once that is
 * known.
 */
async function loadWorkItemForExtend(request, h, id) {
  const user = getUser(request)
  const result = await getWorkItem({ workItemId: id, user })

  if (result.ok === false && result.status === 404) {
    return {
      response: h
        .view(NOT_FOUND_VIEW, {
          pageTitle: 'Application not found',
          heading: 'Application not found',
          workItemId: id,
          breadcrumbs: [
            { text: 'Applications', href: '/work-items' },
            { text: 'Not found' }
          ]
        })
        .code(404)
    }
  }

  if (!result.ok) {
    return {
      response: h
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
  }

  return { workItem: result.workItem }
}

export function makeShowExtendController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const loaded = await loadWorkItemForExtend(request, h, id)
      if (loaded.response) return loaded.response

      const workItem = loaded.workItem
      const applicationRef = workItem.payload.applicationReference
      return h.view(EXTEND_VIEW, {
        pageTitle: EXTEND_HEADING,
        heading: EXTEND_HEADING,
        breadcrumbs: breadcrumbs(id, EXTEND_HEADING, applicationRef),
        workItem: { ...workItem, applicationRef },
        formAction: `/work-items/${encodeURIComponent(id)}/sla/extend`,
        cancelHref: detailHref(id),
        reasonMaxLength: REASON_MAX_LENGTH,
        dateInputId: EXTEND_DEADLINE_ID,
        values: { reason: '', deadline: { day: '', month: '', year: '' } },
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
      const payload = request.payload ?? {}
      const reason = typeof payload.reason === 'string' ? payload.reason : ''
      const deadline = {
        day: payload[`${EXTEND_DEADLINE_ID}-day`] ?? '',
        month: payload[`${EXTEND_DEADLINE_ID}-month`] ?? '',
        year: payload[`${EXTEND_DEADLINE_ID}-year`] ?? ''
      }

      const loaded = await loadWorkItemForExtend(request, h, id)
      if (loaded.response) return loaded.response

      const workItem = loaded.workItem
      const applicationRef = workItem.payload.applicationReference

      const result = await service.extendSla({
        workItemId: id,
        reason,
        deadline,
        currentDueDate: workItem.slaDueDate,
        user: getUser(request)
      })

      if (result.ok) {
        flashBanner(request, {
          type: 'success',
          title: 'Determination deadline extended',
          text: 'The determination deadline has been extended.'
        })
        return h.redirect(detailHref(id))
      }

      if (result.outcome === 'invalid') {
        return h
          .view(EXTEND_VIEW, {
            pageTitle: `Error: ${EXTEND_HEADING}`,
            heading: EXTEND_HEADING,
            breadcrumbs: breadcrumbs(id, EXTEND_HEADING, applicationRef),
            workItem: { ...workItem, applicationRef },
            formAction: `/work-items/${encodeURIComponent(id)}/sla/extend`,
            cancelHref: detailHref(id),
            reasonMaxLength: REASON_MAX_LENGTH,
            dateInputId: EXTEND_DEADLINE_ID,
            values: { reason, deadline },
            errorSummary: {
              titleText: 'There is a problem',
              items: [
                {
                  text: result.message,
                  href:
                    result.field === 'deadline'
                      ? EXTEND_DEADLINE_ANCHOR
                      : '#field-reason'
                }
              ]
            },
            fieldErrors: { [result.field ?? 'reason']: result.message }
          })
          .code(400)
      }

      logger.warn(
        { workItemId: id, outcome: result.outcome, message: result.message },
        'SLA extend failed'
      )
      flashBanner(
        request,
        bannerForSlaFailure(result, 'Could not extend the determination deadline')
      )
      return h.redirect(detailHref(id))
    }
  }
}

export function makeShowOverrideController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const result = await getWorkItem({ workItemId: id, user })

      if (result.ok === false && result.status === 404) {
        return h
          .view(NOT_FOUND_VIEW, {
            pageTitle: 'Application not found',
            heading: 'Application not found',
            workItemId: id,
            breadcrumbs: [
              { text: 'Applications', href: '/work-items' },
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
        pageTitle: OVERRIDE_HEADING,
        heading: OVERRIDE_HEADING,
        breadcrumbs: breadcrumbs(id, OVERRIDE_HEADING, applicationRef),
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
            pageTitle: `Error: ${OVERRIDE_HEADING}`,
            heading: OVERRIDE_HEADING,
            breadcrumbs: breadcrumbs(id, OVERRIDE_HEADING, applicationRef),
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
      flashBanner(request, bannerForSlaFailure(result, 'Could not override SLA'))
      return h.redirect(detailHref(id))
    }
  }
}

function bannerForSlaFailure(result, title) {
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
