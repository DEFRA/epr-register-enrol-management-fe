/**
 * Standard-lifecycle duly-making controllers (RA-316; shared by every
 * opted-in type since RA-495). Each factory takes the `typeId` whose routes
 * it serves: the page is that type's, and its payment details are the ones
 * the type supplies (`standardLifecycle.readPaymentDetails`).
 *
 *  - GET  /work-items/{typeId}/{id}/duly-make — the form. Fetches
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
 * RA-782. A work item that is never charged (an ORS update) has no payment
 * date: the page shows the charge and payment reference as "-", asks for no
 * date, and the POST validates and sends none. management-be says which
 * (`takesPaymentDate` on `GET /work-items/{id}/duly-make`); the type's
 * `standardLifecycle.paymentDate` is only the fallback when that is not to
 * hand (see `related-work-items.js`). A payment-date rejection of a work
 * item that takes none is a page-level banner: there is no field to bind it
 * to.
 *
 * AC04 — Cancel is a plain link straight back to the detail page. It is
 * deliberately NOT a form post: with no handler there is no code path that
 * could touch state, so "Cancel leaves the application in Not started" is
 * true by construction rather than by test.
 */

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import {
  NO_PAYMENT,
  formatChargeAmount
} from '#/server/common/helpers/format/charge-amount.js'

import {
  DULY_MAKE_PAGE,
  getStandardLifecycle,
  lifecyclePageHref,
  takesPaymentDate
} from '../lifecycle.js'
import { evaluateDulyMakeEligibility } from './eligibility.js'
import {
  PAYMENT_DATE_ID,
  buildPaymentDateErrorSummary,
  isPaymentDateErrorCode,
  messageForErrorCode,
  resolvePaymentReference,
  validatePaymentDate
} from './payment-date.js'
import { createDulyMakingService } from './service.js'
import { loadDulyMakeDetails } from './related-work-items.js'

const VIEW_PATH = 'standard-lifecycle/duly-making/index'
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
 *
 * RA-495. The raw values come from the type
 * (`standardLifecycle.readPaymentDetails`): which payload fields hold the
 * charge and the payment reference differs between types.
 *
 * RA-782. `withPaymentDate` is false for a work item that is never charged.
 */
export function buildPaymentDetails(
  workItem,
  typeId,
  withPaymentDate = takesPaymentDate(typeId)
) {
  if (!withPaymentDate) {
    return { chargeAmount: NO_PAYMENT, paymentReference: NO_PAYMENT }
  }
  const raw = getStandardLifecycle(typeId)?.readPaymentDetails?.(workItem) ?? {}
  // `formatChargeAmount` returns null for absent/non-integer only. A
  // legitimate 0 formats as "£0.00" and must NOT collapse to "Not provided" —
  // `??` rather than `||` is doing real work here.
  const charge = formatChargeAmount(raw.chargePence)
  return {
    chargeAmount: charge ?? NOT_PROVIDED,
    // No fallback to `applicationReference` — see `resolvePaymentReference`.
    // Almost every work item renders "Not provided" here today, and that
    // visibility is the point.
    paymentReference:
      resolvePaymentReference({ paymentReference: raw.paymentReference }) ??
      NOT_PROVIDED
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
    typeId,
    id,
    applicationRef,
    paymentDetails,
    dulyMakeDetails,
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
      takesPaymentDate: dulyMakeDetails.takesPaymentDate,
      relatedWorkItems: dulyMakeDetails.relatedWorkItems,
      dateInputId: PAYMENT_DATE_ID,
      formAction: lifecyclePageHref(typeId, id, DULY_MAKE_PAGE),
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
export function makeShowDulyMakingController({ typeId }) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const loaded = await loadWorkItem(request, h, id)
      if (loaded.response) {
        return loaded.response
      }

      const workItem = loaded.workItem
      const eligibility = evaluateDulyMakeEligibility(workItem, { typeId })
      if (!eligibility.allowed) {
        logger.info(
          { workItemId: id, typeId, reason: eligibility.reason },
          'Duly making form refused'
        )
        flashBanner(request, {
          type: 'error',
          text: 'This application cannot be duly made in its current state.'
        })
        return h.redirect(detailHref(id))
      }

      const dulyMakeDetails = await loadDulyMakeDetails({
        typeId,
        workItemId: id,
        user: getUser(request)
      })
      return renderForm(h, {
        typeId,
        id,
        applicationRef: applicationRefOf(workItem),
        paymentDetails: buildPaymentDetails(
          workItem,
          typeId,
          dulyMakeDetails.takesPaymentDate
        ),
        dulyMakeDetails
      })
    }
  }
}

/** POST — validate, submit, PRG. */
export function makeSubmitDulyMakingController({
  typeId,
  service = createDulyMakingService({ typeId })
}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const values = paymentDateValues(request.payload)

      // RA-782: a work item with no payment date has nothing to validate or
      // send. Decided as the page that posted here decided it.
      const dulyMakeDetails = await loadDulyMakeDetails({
        typeId,
        workItemId: id,
        user
      })
      const withDate = dulyMakeDetails.takesPaymentDate
      const validation = withDate
        ? validatePaymentDate(values)
        : { ok: true, value: null }
      if (!validation.ok) {
        return renderInvalid(h, {
          typeId,
          id,
          user,
          dulyMakeDetails,
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
        user,
        withPaymentDate: withDate
      })

      if (result.ok) {
        flashBanner(
          request,
          withDate ? SUCCESS_BANNER : SUCCESS_BANNER_WITHOUT_PAYMENT
        )
        return h.redirect(detailHref(id))
      }

      logger.warn(
        {
          workItemId: id,
          typeId,
          outcome: result.outcome,
          status: result.status,
          errorCode: result.errorCode,
          // The backend's `detail` is developer-facing. Log it; the user
          // sees our own copy.
          message: result.message
        },
        'Duly making failed'
      )

      // Only a payment-date rejection binds to the field, and only when the
      // page has the field. Everything else is a page-level problem and a
      // field error would point the user at the wrong thing.
      if (withDate && isPaymentDateErrorCode(result.errorCode)) {
        return renderInvalid(h, {
          typeId,
          id,
          user,
          dulyMakeDetails,
          values,
          errorCode: result.errorCode
        })
      }

      flashBanner(request, bannerForFailure(result, withDate))
      return h.redirect(detailHref(id))
    }
  }
}

/** The three date boxes as posted, each empty when absent. */
function paymentDateValues(payload) {
  const posted = payload ?? {}
  return {
    day: posted[`${PAYMENT_DATE_ID}-day`] ?? '',
    month: posted[`${PAYMENT_DATE_ID}-month`] ?? '',
    year: posted[`${PAYMENT_DATE_ID}-year`] ?? ''
  }
}

/**
 * Re-render the form with an error. The work item is re-read so the
 * read-only payment details survive the round trip; if that read fails the
 * page still renders, degraded, rather than turning a validation error into
 * a 502.
 */
async function renderInvalid(
  h,
  { typeId, id, user, dulyMakeDetails, values, errorCode }
) {
  const item = await getWorkItem({ workItemId: id, user })
  const withDate = dulyMakeDetails.takesPaymentDate
  return renderForm(h, {
    typeId,
    id,
    applicationRef: item.ok ? applicationRefOf(item.workItem) : null,
    paymentDetails: item.ok
      ? buildPaymentDetails(item.workItem, typeId, withDate)
      : unreadPaymentDetails(withDate),
    dulyMakeDetails,
    values,
    errorCode,
    statusCode: 400
  })
}

/** The payment details when the work item could not be re-read. */
function unreadPaymentDetails(withPaymentDate) {
  return withPaymentDate
    ? { chargeAmount: NOT_PROVIDED, paymentReference: NOT_PROVIDED }
    : { chargeAmount: NO_PAYMENT, paymentReference: NO_PAYMENT }
}

const SUCCESS_BANNER = {
  type: 'success',
  title: 'Application duly made',
  text: 'The payment date has been recorded and the application is now duly made.'
}

// RA-782: nothing was paid, so no payment date was recorded.
// Provisional copy: not in the design, pending content design review.
const SUCCESS_BANNER_WITHOUT_PAYMENT = {
  type: 'success',
  title: 'Application duly made',
  text: 'The application is now duly made.'
}

const FAILURE_TITLE = 'Could not complete duly making'

/**
 * RA-782. The page sent no payment date and management-be still asked for one
 * (in practice `payment-date-required`): the two disagree about whether the
 * type takes a date. There is no field to fix and trying again changes
 * nothing. Provisional copy: not in the design, pending content design review.
 */
const PAYMENT_DATE_REFUSED_BANNER = {
  type: 'error',
  title: FAILURE_TITLE,
  text: 'There was a problem duly making this application. It has not been duly made.'
}

function bannerForFailure(result, withPaymentDate) {
  if (!withPaymentDate && isPaymentDateErrorCode(result.errorCode)) {
    return PAYMENT_DATE_REFUSED_BANNER
  }
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
