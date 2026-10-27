/**
 * Re-accreditation change-payment-date controllers (RA-576).
 *
 *  - GET  /work-items/re-accreditation/{id}/change-payment-date — the form,
 *    showing the current payment date. An item that is not eligible bounces
 *    to the detail page before the user types anything.
 *  - POST same path — validates the date and reason, hands off to
 *    {@link createChangePaymentDateService} and PRG-redirects to the detail
 *    page with a success banner.
 *
 * Validation failures re-render in place with `.code(400)` and a GOV.UK error
 * summary anchored to the offending input(s). Structural failures (409, 404,
 * a wiring fault) redirect with a flash banner: a field error would be
 * misleading when the problem is not the field.
 *
 * Cancel is a plain link back to the detail page, never a form post.
 */

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

import {
  PAYMENT_DATE_ANCHOR,
  PAYMENT_DATE_ID,
  isPaymentDateErrorCode,
  messageForErrorCode,
  validatePaymentDate
} from '../duly-making/payment-date.js'
import {
  REASON_ANCHOR,
  REASON_ID,
  isReasonErrorCode,
  messageForReasonErrorCode,
  validateReason
} from './reason.js'
import {
  evaluateChangePaymentDateEligibility,
  readPaymentDate
} from './eligibility.js'
import { createChangePaymentDateService } from './service.js'

const VIEW_PATH = 're-accreditation/change-payment-date/index'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

const PAGE_TITLE = 'Change payment date'
const APPLICATIONS_LABEL = 'Applications'
const WORK_ITEMS_HREF = '/work-items'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function changePaymentDateHref(id) {
  return `/work-items/re-accreditation/${encodeURIComponent(id)}/change-payment-date`
}

function breadcrumbs(id, ref) {
  return [
    { text: APPLICATIONS_LABEL, href: WORK_ITEMS_HREF },
    { text: ref ?? 'Application', href: detailHref(id) },
    { text: PAGE_TITLE }
  ]
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

function applicationRefOf(workItem) {
  return (
    workItem?.applicationReference ??
    workItem?.payload?.applicationReference ??
    null
  )
}

function renderForm(
  h,
  {
    id,
    applicationRef,
    currentPaymentDate,
    values = { day: '', month: '', year: '', reason: '' },
    dateErrorCode = null,
    reasonErrorCode = null,
    statusCode = statusCodes.ok
  }
) {
  const dateErrorMessage = messageForErrorCode(dateErrorCode)
  const reasonErrorMessage = messageForReasonErrorCode(reasonErrorCode)
  const errorItems = [
    dateErrorMessage && { text: dateErrorMessage, href: PAYMENT_DATE_ANCHOR },
    reasonErrorMessage && { text: reasonErrorMessage, href: REASON_ANCHOR }
  ].filter(Boolean)

  return h
    .view(VIEW_PATH, {
      pageTitle: errorItems.length > 0 ? `Error: ${PAGE_TITLE}` : PAGE_TITLE,
      heading: PAGE_TITLE,
      breadcrumbs: breadcrumbs(id, applicationRef),
      workItem: { id, applicationRef },
      currentPaymentDate,
      dateInputId: PAYMENT_DATE_ID,
      reasonId: REASON_ID,
      formAction: changePaymentDateHref(id),
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

async function loadWorkItem(request, h, id) {
  const user = getUser(request)
  const result = await getWorkItem({ workItemId: id, user })

  if (result.ok === false && result.status === statusCodes.notFound) {
    return {
      response: h
        .view(NOT_FOUND_VIEW, {
          pageTitle: 'Application not found',
          heading: 'Application not found',
          workItemId: id,
          breadcrumbs: [
            { text: APPLICATIONS_LABEL, href: WORK_ITEMS_HREF },
            { text: 'Not found' }
          ]
        })
        .code(statusCodes.notFound)
    }
  }

  if (!result.ok) {
    return {
      response: h
        .view(UNAVAILABLE_VIEW, {
          pageTitle: 'Application unavailable',
          heading: 'Application unavailable',
          workItemId: id,
          error: result.error ?? `Backend returned ${result.status}`,
          breadcrumbs: [
            { text: APPLICATIONS_LABEL, href: WORK_ITEMS_HREF },
            { text: 'Application' }
          ]
        })
        .code(statusCodes.badGateway)
    }
  }

  return { workItem: result.workItem }
}

/** GET — render the change-payment-date form. */
export function makeShowChangePaymentDateController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const loaded = await loadWorkItem(request, h, id)
      if (loaded.response) {
        return loaded.response
      }

      const workItem = loaded.workItem
      const eligibility = evaluateChangePaymentDateEligibility(workItem)
      if (!eligibility.allowed) {
        logger.info(
          { workItemId: id, reason: eligibility.reason },
          'Change payment date form refused'
        )
        flashBanner(request, {
          type: 'error',
          text: 'The payment date of this application cannot be changed.'
        })
        return h.redirect(detailHref(id))
      }

      return renderForm(h, {
        id,
        applicationRef: applicationRefOf(workItem),
        currentPaymentDate: readPaymentDate(workItem).display
      })
    }
  }
}

function readFormValues(payload) {
  const body = payload ?? {}
  return {
    day: body[`${PAYMENT_DATE_ID}-day`] ?? '',
    month: body[`${PAYMENT_DATE_ID}-month`] ?? '',
    year: body[`${PAYMENT_DATE_ID}-year`] ?? '',
    reason: body[REASON_ID] ?? ''
  }
}

/**
 * Bind a backend 400's `errorCode` to its field. `null` for anything else (a
 * 409, a 404, an unrecognised code), which is a page-level problem.
 */
function fieldErrorsFromBackend(errorCode) {
  if (isPaymentDateErrorCode(errorCode)) {
    return { dateErrorCode: errorCode, reasonErrorCode: null }
  }
  if (isReasonErrorCode(errorCode)) {
    return { dateErrorCode: null, reasonErrorCode: errorCode }
  }
  return null
}

/** POST — validate, submit, PRG. */
export function makeSubmitChangePaymentDateController({
  service = createChangePaymentDateService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const values = readFormValues(request.payload)

      // Both fields are validated before anything is rejected so the user
      // sees every problem at once.
      const date = validatePaymentDate(values)
      const reason = validateReason(values.reason)
      if (!date.ok || !reason.ok) {
        return renderInvalid(h, {
          id,
          user,
          values,
          dateErrorCode: date.ok ? null : date.errorCode,
          reasonErrorCode: reason.ok ? null : reason.errorCode
        })
      }

      // No client-side eligibility re-check: the backend re-validates state
      // and answers 409, mapped below.
      const result = await service.changePaymentDateForWorkItem({
        workItemId: id,
        paymentDate: date.value,
        reason: reason.value,
        user
      })

      if (result.ok) {
        flashBanner(request, SUCCESS_BANNER)
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
        'Re-accreditation payment date change failed'
      )

      const fieldErrors = fieldErrorsFromBackend(result.errorCode)
      if (fieldErrors) {
        return renderInvalid(h, { id, user, values, ...fieldErrors })
      }

      flashBanner(request, bannerForFailure(result))
      return h.redirect(detailHref(id))
    }
  }
}

/**
 * Re-render the form with errors. The work item is re-read so the current
 * payment date survives the round trip; if that read fails the page still
 * renders, degraded, rather than turning a validation error into a 502.
 */
async function renderInvalid(
  h,
  { id, user, values, dateErrorCode, reasonErrorCode }
) {
  const item = await getWorkItem({ workItemId: id, user })
  return renderForm(h, {
    id,
    applicationRef: item.ok ? applicationRefOf(item.workItem) : null,
    currentPaymentDate: item.ok
      ? (readPaymentDate(item.workItem)?.display ?? null)
      : null,
    values,
    dateErrorCode,
    reasonErrorCode,
    statusCode: statusCodes.badRequest
  })
}

const SUCCESS_BANNER = {
  type: 'success',
  title: 'Success',
  text: 'The payment date has been updated'
}

const FAILURE_TITLE = 'Could not change the payment date'

function bannerForFailure(result) {
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title: FAILURE_TITLE,
      text: 'This application has changed and its payment date can no longer be changed. Refresh and try again.'
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
    text: 'There was a problem changing the payment date. Try again.'
  }
}
