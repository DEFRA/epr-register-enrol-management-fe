/**
 * Re-accreditation duly-making controllers (RA-316).
 *
 *  - GET  /work-items/re-accreditation/{id}/duly-make — the form. Fetches
 *    the work item so the payment details can be pre-populated and so an
 *    application that is no longer duly-makeable bounces before the user
 *    types a date they cannot submit.
 *  - POST same path — validates the date, hands off to
 *    {@link createDulyMakingService} and PRG-redirects to the detail page.
 *
 * Validation failures re-render in place with `.code(400)` and a GOV.UK
 * error summary anchored to the date input. Structural failures (409, 404,
 * a wiring fault) redirect with a flash banner instead: a field error would
 * be actively misleading when the problem is not the field.
 *
 * AC04 — Cancel is a plain link straight back to the detail page. It is
 * deliberately NOT a form post: with no handler there is no code path that
 * could touch state, so "Cancel leaves the application in Not started" is
 * true by construction rather than by test.
 */

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import { evaluateDulyMakeEligibility } from './eligibility.js'
import {
  PAYMENT_DATE_ID,
  buildPaymentDateErrorSummary,
  formatChargeAmount,
  isPaymentDateErrorCode,
  messageForErrorCode,
  resolvePaymentReference,
  validatePaymentDate
} from './payment-date.js'
import { createDulyMakingService } from './service.js'

const VIEW_PATH = 're-accreditation/duly-making/index'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

const PAGE_TITLE = 'Duly making'
const HEADING = 'Duly make the application'

/**
 * Shown when a payload field is absent. An explicit sentence rather than
 * an empty cell: a blank value on a financial screen reads as a rendering
 * fault, and the regulator cannot tell "we do not have this" from "this
 * failed to load".
 */
const NOT_PROVIDED = 'Not provided'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function dulyMakeHref(id) {
  return `/work-items/re-accreditation/${encodeURIComponent(id)}/duly-make`
}

function breadcrumbs(id, ref) {
  return [
    { text: 'Applications', href: '/work-items' },
    { text: ref ?? 'Application', href: detailHref(id) },
    { text: PAGE_TITLE }
  ]
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

/**
 * Build the read-only payment-details block.
 *
 * Both fields degrade independently — an older work item may carry neither,
 * and duly making still succeeds without them, so a missing value must
 * never block the page or the submission.
 */
export function buildPaymentDetails(workItem) {
  // Both fields live INSIDE `payload`, not at the top level. `payload` is
  // passed through verbatim from MongoDB and is not re-cased by the
  // backend's response serialiser, so these two keys' casing is owned by
  // legacy-be — a mis-cased key throws nowhere and simply renders blank,
  // which is why the tests assert on rendered VALUES rather than on the
  // element being present.
  const payload = workItem?.payload ?? {}
  // `formatChargeAmount` returns null for absent/non-integer only. A
  // legitimate 0 formats as "£0" and must NOT collapse to "Not provided" —
  // `??` rather than `||` is doing real work here.
  const charge = formatChargeAmount(payload.chargeAmountPence)
  return {
    chargeAmount: charge ?? NOT_PROVIDED,
    // No fallback to `applicationReference` — see `resolvePaymentReference`.
    // Almost every work item renders "Not provided" here today, and that
    // visibility is the point.
    paymentReference: resolvePaymentReference(payload) ?? NOT_PROVIDED
  }
}

/**
 * The application reference for the caption and breadcrumb.
 *
 * Prefers the TOP-LEVEL field, which the framework guarantees, over the
 * duplicate inside `payload` — same value, but the payload copy comes
 * straight from Mongo without the serialiser's casing guarantees.
 */
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
    paymentDetails,
    values = { day: '', month: '', year: '' },
    errorCode = null,
    statusCode = 200
  }
) {
  const errorMessage = messageForErrorCode(errorCode)
  return h
    .view(VIEW_PATH, {
      pageTitle: errorMessage ? `Error: ${PAGE_TITLE}` : PAGE_TITLE,
      heading: HEADING,
      breadcrumbs: breadcrumbs(id, applicationRef),
      workItem: { id, applicationRef },
      paymentDetails,
      dateInputId: PAYMENT_DATE_ID,
      formAction: dulyMakeHref(id),
      cancelHref: detailHref(id),
      values,
      errorMessage,
      errorSummary: buildPaymentDateErrorSummary(errorCode)
    })
    .code(statusCode)
}

async function loadWorkItem(request, h, id) {
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
          pageTitle: 'Application unavailable',
          heading: 'Application unavailable',
          workItemId: id,
          error: result.error ?? `Backend returned ${result.status}`,
          breadcrumbs: [
            { text: 'Applications', href: '/work-items' },
            { text: 'Application' }
          ]
        })
        .code(502)
    }
  }

  return { workItem: result.workItem }
}

/** GET — render the duly-making form. */
export function makeShowDulyMakingController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const loaded = await loadWorkItem(request, h, id)
      if (loaded.response) return loaded.response

      const workItem = loaded.workItem
      const eligibility = evaluateDulyMakeEligibility(workItem)
      if (!eligibility.allowed) {
        logger.info(
          { workItemId: id, reason: eligibility.reason },
          'Duly making form refused'
        )
        flashBanner(request, {
          type: 'error',
          text: 'This application cannot be duly made in its current state.'
        })
        return h.redirect(detailHref(id))
      }

      return renderForm(h, {
        id,
        applicationRef: applicationRefOf(workItem),
        paymentDetails: buildPaymentDetails(workItem)
      })
    }
  }
}

/** POST — validate, submit, PRG. */
export function makeSubmitDulyMakingController({
  service = createDulyMakingService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const payload = request.payload ?? {}
      const values = {
        day: payload[`${PAYMENT_DATE_ID}-day`] ?? '',
        month: payload[`${PAYMENT_DATE_ID}-month`] ?? '',
        year: payload[`${PAYMENT_DATE_ID}-year`] ?? ''
      }

      const validation = validatePaymentDate(values)
      if (!validation.ok) {
        return renderInvalid(h, {
          request,
          id,
          user,
          values,
          errorCode: validation.errorCode
        })
      }

      // Deliberately no client-side re-check of eligibility here. The
      // backend re-validates state, type and terminality on every call and
      // answers 409, which is mapped below — a second GET would cost a
      // round trip and still race.
      const result = await service.dulyMakeWorkItem({
        workItemId: id,
        paymentDate: validation.value,
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
          // The backend's `detail` is developer-facing. Log it; the user
          // sees our own copy.
          message: result.message
        },
        'Re-accreditation duly making failed'
      )

      // Only a payment-date rejection binds to the field. Everything else
      // is a page-level problem and a field error would point the user at
      // the wrong thing.
      if (isPaymentDateErrorCode(result.errorCode)) {
        return renderInvalid(h, {
          request,
          id,
          user,
          values,
          errorCode: result.errorCode
        })
      }

      flashBanner(request, bannerForFailure(result))
      return h.redirect(detailHref(id))
    }
  }
}

/**
 * Re-render the form with an error. The work item is re-read so the
 * read-only payment details survive the round trip; if that read fails the
 * page still renders, degraded, rather than turning a validation error into
 * a 502.
 */
async function renderInvalid(h, { request, id, user, values, errorCode }) {
  const item = await getWorkItem({ workItemId: id, user })
  return renderForm(h, {
    id,
    applicationRef: item.ok ? applicationRefOf(item.workItem) : null,
    paymentDetails: item.ok
      ? buildPaymentDetails(item.workItem)
      : { chargeAmount: NOT_PROVIDED, paymentReference: NOT_PROVIDED },
    values,
    errorCode,
    statusCode: 400
  })
}

const SUCCESS_BANNER = {
  type: 'success',
  title: 'Application duly made',
  text: 'The payment date has been recorded and the application is now duly made.'
}

const FAILURE_TITLE = 'Could not complete duly making'

function bannerForFailure(result) {
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title: FAILURE_TITLE,
      // 409 means the item moved under us. "Refresh and try again" is the
      // correct instruction; a field error would be a lie.
      text: 'This application has changed and can no longer be duly made. Refresh and try again.'
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
    text: 'There was a problem completing duly making. Try again.'
  }
}
