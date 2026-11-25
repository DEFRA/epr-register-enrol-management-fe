/**
 * Standard-lifecycle change-valid-from controllers (RA-800; modelled on
 * re-accreditation's RA-576 change payment date).
 *
 * Two handlers, both at `/work-items/{typeId}/{id}/change-valid-from`, each
 * factory taking the `typeId` whose routes it serves:
 *
 *  - GET: the form, showing the current valid from date. A case that is not
 *    eligible (see `./eligibility.js`, the same gate as the link) bounces to
 *    the detail page before the user types anything.
 *  - POST: validates the date (the same accreditation-year bounds as Make
 *    determination) and the reason, hands off to the service and
 *    PRG-redirects to the detail page with an "Updated" banner.
 *
 * Validation failures re-render in place with `.code(400)` and a GOV.UK error
 * summary anchored to the offending input(s). Structural failures (409, 404,
 * a wiring fault) redirect with a flash banner: a field error would be
 * misleading when the problem is not the field.
 *
 * Cancel is a plain link back to the detail page, never a form post.
 */

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import {
  EFFECTIVE_DATE_ANCHOR,
  EFFECTIVE_DATE_ID,
  accreditationYearOf,
  effectiveDateMessage,
  isEffectiveDateErrorCode,
  validateEffectiveDate
} from '../decision/effective-date.js'
import { CHANGE_VALID_FROM_PAGE, lifecyclePageHref } from '../lifecycle.js'
import {
  evaluateChangeValidFromEligibility,
  readValidFromDate
} from './eligibility.js'
import {
  REASON_ANCHOR,
  REASON_ID,
  isReasonErrorCode,
  messageForReasonErrorCode,
  validateReason
} from './reason.js'
import { createChangeValidFromService } from './service.js'

const VIEW_PATH = 'standard-lifecycle/change-valid-from/index'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

const PAGE_TITLE = 'Change valid from date'
const WORK_ITEMS_LABEL = 'Work items'
const WORK_ITEMS_HREF = '/work-items'
const FAILURE_TITLE = 'Could not change the valid from date'

const EMPTY_VALUES = Object.freeze({
  day: '',
  month: '',
  year: '',
  reason: ''
})

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function changeValidFromHref(typeId, id) {
  return lifecyclePageHref(typeId, id, CHANGE_VALID_FROM_PAGE)
}

function breadcrumbs(id, ref) {
  return [
    { text: WORK_ITEMS_LABEL, href: WORK_ITEMS_HREF },
    { text: ref ?? 'Work item', href: detailHref(id) },
    { text: PAGE_TITLE }
  ]
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

function applicationRefOf(workItem) {
  return workItem?.payload?.applicationReference ?? null
}

/** `YYYY-MM-DD` -> `dd/mm/yyyy` (the value is already validated). */
function displayDate(iso) {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function renderNotFound(h, id) {
  return h
    .view(NOT_FOUND_VIEW, {
      pageTitle: 'Application not found',
      heading: 'Application not found',
      workItemId: id,
      breadcrumbs: [
        { text: WORK_ITEMS_LABEL, href: WORK_ITEMS_HREF },
        { text: 'Not found' }
      ]
    })
    .code(statusCodes.notFound)
}

function renderUnavailable(h, id, result) {
  return h
    .view(UNAVAILABLE_VIEW, {
      pageTitle: 'Application unavailable',
      heading: 'Application unavailable',
      workItemId: id,
      error: result.error ?? `Backend returned ${result.status}`,
      breadcrumbs: [
        { text: WORK_ITEMS_LABEL, href: WORK_ITEMS_HREF },
        { text: 'Application' }
      ]
    })
    .code(statusCodes.badGateway)
}

function renderForm(
  h,
  {
    typeId,
    workItem,
    values = EMPTY_VALUES,
    dateErrorCode = null,
    reasonErrorCode = null,
    statusCode = statusCodes.ok
  }
) {
  const id = workItem.id
  const dateErrorMessage = effectiveDateMessage(
    dateErrorCode,
    accreditationYearOf(workItem)
  )
  const reasonErrorMessage = messageForReasonErrorCode(reasonErrorCode)
  const errorItems = [
    dateErrorMessage && { text: dateErrorMessage, href: EFFECTIVE_DATE_ANCHOR },
    reasonErrorMessage && { text: reasonErrorMessage, href: REASON_ANCHOR }
  ].filter(Boolean)
  const applicationRef = applicationRefOf(workItem)

  return h
    .view(VIEW_PATH, {
      pageTitle: errorItems.length > 0 ? `Error: ${PAGE_TITLE}` : PAGE_TITLE,
      heading: PAGE_TITLE,
      breadcrumbs: breadcrumbs(id, applicationRef),
      workItem: { id, applicationRef },
      currentValidFromDate: readValidFromDate(workItem)?.display ?? null,
      dateInputId: EFFECTIVE_DATE_ID,
      reasonId: REASON_ID,
      formAction: changeValidFromHref(typeId, id),
      cancelHref: detailHref(id),
      values,
      dateErrorMessage,
      reasonErrorMessage,
      errorSummary:
        errorItems.length > 0
          ? { titleText: 'There is a problem', items: errorItems }
          : null
    })
    .code(statusCode)
}

function ineligibleBanner() {
  return {
    type: 'error',
    title: FAILURE_TITLE,
    text: 'The valid from date of this application cannot be changed.'
  }
}

function successBanner(isoDate) {
  return {
    type: 'success',
    title: 'Updated',
    text: `Valid from date updated to ${displayDate(isoDate)}. You now need to contact the applicant about the decision.`
  }
}

function bannerForFailure(result) {
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title: FAILURE_TITLE,
      text: 'This application has changed and its valid from date can no longer be changed. Refresh and try again.'
    }
  }
  if (result.outcome === 'not-found') {
    return {
      type: 'error',
      title: FAILURE_TITLE,
      text: 'This application could not be found.'
    }
  }
  return {
    type: 'error',
    title: FAILURE_TITLE,
    text: 'There was a problem changing the valid from date. Try again.'
  }
}

/**
 * Bind a backend 400's `errorCode` to its field. `null` for anything else (a
 * 409, a 404, `wrong-work-item-type`, an unrecognised code), which is a
 * page-level problem.
 */
function fieldErrorsFromBackend(errorCode) {
  if (isEffectiveDateErrorCode(errorCode)) {
    return { dateErrorCode: errorCode, reasonErrorCode: null }
  }
  if (isReasonErrorCode(errorCode)) {
    return { dateErrorCode: null, reasonErrorCode: errorCode }
  }
  return null
}

function readFormValues(payload) {
  const body = payload ?? {}
  const text = (key) => (typeof body[key] === 'string' ? body[key] : '')
  return {
    day: text(`${EFFECTIVE_DATE_ID}-day`),
    month: text(`${EFFECTIVE_DATE_ID}-month`),
    year: text(`${EFFECTIVE_DATE_ID}-year`),
    reason: text(REASON_ID)
  }
}

/** GET — render the change-valid-from form. */
export function makeShowChangeValidFromController({ typeId }) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const result = await getWorkItem({
        workItemId: id,
        user: getUser(request)
      })
      if (result.ok === false && result.status === statusCodes.notFound) {
        return renderNotFound(h, id)
      }
      if (!result.ok) {
        return renderUnavailable(h, id, result)
      }

      // Guard the ROUTE, not just the link: the URL is guessable and the
      // state may have moved on since the detail page was rendered.
      const eligibility = evaluateChangeValidFromEligibility(result.workItem, {
        typeId
      })
      if (!eligibility.allowed) {
        logger.info(
          { workItemId: id, reason: eligibility.reason },
          'Change valid from date form refused'
        )
        flashBanner(request, ineligibleBanner())
        return h.redirect(detailHref(id))
      }

      return renderForm(h, { typeId, workItem: result.workItem })
    }
  }
}

/** POST — validate, submit, PRG. */
export function makeSubmitChangeValidFromController({
  typeId,
  service = createChangeValidFromService({ typeId })
}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const values = readFormValues(request.payload)

      // Read first: the date is bounded by the work item's accreditation
      // year, the form re-renders with the current date, and the gate must be
      // re-checked against the state as it is now.
      const current = await getWorkItem({ workItemId: id, user })
      if (current.ok === false && current.status === statusCodes.notFound) {
        return renderNotFound(h, id)
      }
      if (!current.ok) {
        logger.warn(
          { workItemId: id, status: current.status },
          'Could not verify valid from date change eligibility'
        )
        flashBanner(request, bannerForFailure({ outcome: 'server' }))
        return h.redirect(detailHref(id))
      }

      const workItem = current.workItem
      const eligibility = evaluateChangeValidFromEligibility(workItem, {
        typeId
      })
      if (!eligibility.allowed) {
        logger.warn(
          { workItemId: id, reason: eligibility.reason },
          'Blocked valid from date change: work item is not eligible'
        )
        flashBanner(request, ineligibleBanner())
        return h.redirect(detailHref(id))
      }

      // Both fields are validated before anything is rejected so the user
      // sees every problem at once.
      const date = validateEffectiveDate(values, accreditationYearOf(workItem))
      const reason = validateReason(values.reason)
      if (!date.ok || !reason.ok) {
        return renderForm(h, {
          typeId,
          workItem,
          values,
          dateErrorCode: date.ok ? null : date.errorCode,
          reasonErrorCode: reason.ok ? null : reason.errorCode,
          statusCode: statusCodes.badRequest
        })
      }

      const result = await service.changeValidFromForWorkItem({
        workItemId: id,
        effectiveDate: date.value,
        reason: reason.value,
        user
      })

      if (result.ok) {
        flashBanner(request, successBanner(date.value))
        return h.redirect(detailHref(id))
      }

      logger.warn(
        {
          workItemId: id,
          outcome: result.outcome,
          status: result.status,
          errorCode: result.errorCode,
          // The backend's `detail` is developer-facing: log it, never render it.
          message: result.message
        },
        'Valid from date change failed'
      )

      const fieldErrors = fieldErrorsFromBackend(result.errorCode)
      if (fieldErrors) {
        return renderForm(h, {
          typeId,
          workItem,
          values,
          ...fieldErrors,
          statusCode: statusCodes.badRequest
        })
      }

      flashBanner(request, bannerForFailure(result))
      return h.redirect(detailHref(id))
    }
  }
}
