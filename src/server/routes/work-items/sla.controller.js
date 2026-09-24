/**
 * Determination-deadline CHANGE controllers (RA-131 as "SLA extend",
 * relabelled to "Determination Deadline" by RA-447 CM5/CM6, which also
 * replaced the day-count input with a calendar date input and removed the
 * extension cap; RA-601 then removed the extension-only direction rule, so
 * the deadline can be advanced as well as pushed back).
 *
 * RA-572 deleted the sibling Override controllers: UAT found "Change" and
 * "Override" indistinguishable, so Change is now the single regulator-facing
 * route for amending a determination deadline and all user-facing copy
 * describes a CHANGE rather than an extension. The internal ids, the
 * `/sla/extend` route and the `sla-extend-*` testids are deliberately
 * unchanged — this is a content + removal change, not a rename of the
 * wiring. management-be's `SlaService.OverrideAsync` is untouched.
 */

import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { REASON_MAX_LENGTH, createSlaService } from './sla.service.js'

const EXTEND_VIEW = 'work-items/sla-extend'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'
const WORK_ITEMS_HREF = '/work-items'
const WORK_ITEMS_BREADCRUMB = 'Work items'
const NOT_FOUND_TITLE = 'Application not found'
const UNAVAILABLE_TITLE = 'Work item unavailable'

// RA-447 CM6. The `govukDateInput` id / name prefix for the new
// determination deadline, and the error-summary anchor (the DAY box, so
// focus lands on the first field of the group).
const EXTEND_DEADLINE_ID = 'new-deadline'
const EXTEND_DEADLINE_ANCHOR = `#${EXTEND_DEADLINE_ID}-day`

// RA-572. This single constant drives pageTitle/heading/breadcrumb on both
// the GET and the validation-error re-render.
const EXTEND_HEADING = 'Change determination deadline'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

function breadcrumbs(id, action, ref) {
  return [
    { text: WORK_ITEMS_BREADCRUMB, href: WORK_ITEMS_HREF },
    { text: ref ?? 'Work item', href: detailHref(id) },
    { text: action }
  ]
}

/**
 * Fetch the work item for the extend flow, or the not-found / unavailable
 * view when that fails. Shared between the GET and POST handlers because
 * RA-447 CM6 needs the work item's CURRENT `slaDueDate` on submit too — the
 * new deadline is validated against it, and (since RA-601) the signed
 * day-gap sent to the backend is derived from it.
 */
async function loadWorkItemForExtend(request, h, id) {
  const user = getUser(request)
  const result = await getWorkItem({ workItemId: id, user })

  if (result.ok === false && result.status === 404) {
    return {
      response: h
        .view(NOT_FOUND_VIEW, {
          pageTitle: NOT_FOUND_TITLE,
          heading: NOT_FOUND_TITLE,
          workItemId: id,
          breadcrumbs: [
            { text: 'Applications', href: WORK_ITEMS_HREF },
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
          pageTitle: UNAVAILABLE_TITLE,
          heading: UNAVAILABLE_TITLE,
          workItemId: id,
          error: result.error ?? `Backend returned ${result.status}`,
          breadcrumbs: [
            { text: WORK_ITEMS_BREADCRUMB, href: WORK_ITEMS_HREF },
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
      if (loaded.response) {
        return loaded.response
      }

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

/** The error-summary link for an invalid-outcome field: the deadline's day
 * box for a deadline error, the reason field for anything else. */
function extendErrorHref(field) {
  return field === 'deadline' ? EXTEND_DEADLINE_ANCHOR : '#field-reason'
}

function renderExtendInvalid(
  h,
  { id, workItem, applicationRef, reason, deadline, result }
) {
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
        items: [{ text: result.message, href: extendErrorHref(result.field) }]
      },
      fieldErrors: { [result.field ?? 'reason']: result.message }
    })
    .code(400)
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
      if (loaded.response) {
        return loaded.response
      }

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
          title: 'Determination deadline changed',
          text: 'The determination deadline has been changed.'
        })
        return h.redirect(detailHref(id))
      }

      if (result.outcome === 'invalid') {
        return renderExtendInvalid(h, {
          id,
          workItem,
          applicationRef,
          reason,
          deadline,
          result
        })
      }

      logger.warn(
        { workItemId: id, outcome: result.outcome, message: result.message },
        'Determination deadline change failed'
      )
      flashBanner(
        request,
        bannerForSlaFailure(
          result,
          'Could not change the determination deadline'
        )
      )
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
    text: result.message ?? 'The determination deadline could not be updated.'
  }
}
