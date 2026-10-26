/**
 * Re-accreditation confirm-contact controllers (RA-527, step 2 of the
 * two-step determination).
 *
 * Two handlers — both at `/work-items/re-accreditation/{id}/confirm-contact`:
 *
 *  - GET: render the confirm page — one checkbox ("I have contacted the
 *    applicant about the decision"), "Confirm and continue" and Cancel.
 *
 *  - POST: re-check the item is still pending contact, validate the
 *    checkbox, then ask the service to apply the determination. On success,
 *    PRG-redirect to the detail page with a one-time "Applicant contacted"
 *    flash banner. An unticked box re-renders with a GOV.UK error summary; a
 *    backend failure re-renders with an error banner (management-be applied
 *    nothing, so the regulator can retry from the same page).
 *
 * An item that is not pending contact (not yet determined, or already
 * applied) is redirected to the detail page by both handlers, which shows
 * where it actually is. The page is the same for approvals and refusals;
 * only the success banner's wording depends on the outcome.
 */

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import {
  STATE_APPROVED_PENDING_CONTACT,
  STATE_REJECTED_PENDING_CONTACT,
  isPendingContact
} from '../states.js'
import { createConfirmContactService } from './service.js'

const VIEW_PATH = 're-accreditation/confirm-contact/index'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'
const WORK_ITEMS_HREF = '/work-items'

const PAGE_TITLE = 'Confirm applicant contact'
const FAILED_TITLE = 'Could not confirm applicant contact'

// The checkbox's own id. The error summary links to it, so the two must not
// drift; mgmt-tests selects on the testid, not this.
export const CONFIRM_FIELD_ID = 'applicantContacted'
const MISSING_CONFIRMATION_MESSAGE =
  'Confirm you have contacted the applicant about the decision'

/**
 * One-time success banner, keyed by the pending state the item was confirmed
 * from (the backend decides where it lands; this only picks the wording).
 */
const SUCCESS_BANNERS = Object.freeze({
  [STATE_APPROVED_PENDING_CONTACT]: Object.freeze({
    type: 'success',
    title: 'Applicant contacted',
    text: 'The applicant has been contacted and accreditation is granted.'
  }),
  // Provisional refusal copy (extrapolated from Design 3's approval screens).
  [STATE_REJECTED_PENDING_CONTACT]: Object.freeze({
    type: 'success',
    title: 'Applicant contacted',
    text: 'The applicant has been contacted and accreditation is refused.'
  })
})

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function confirmContactHref(id) {
  return `/work-items/re-accreditation/${encodeURIComponent(id)}/confirm-contact`
}

function renderNotFound(h, id) {
  return h
    .view(NOT_FOUND_VIEW, {
      pageTitle: 'Application not found',
      heading: 'Application not found',
      workItemId: id,
      breadcrumbs: [
        { text: 'Applications', href: WORK_ITEMS_HREF },
        { text: 'Not found' }
      ]
    })
    .code(statusCodes.notFound)
}

function renderUnavailable(h, id, result) {
  return h
    .view(UNAVAILABLE_VIEW, {
      pageTitle: 'Work item unavailable',
      heading: 'Work item unavailable',
      workItemId: id,
      error: result.error ?? `Backend returned ${result.status}`,
      breadcrumbs: [{ text: 'Work items', href: WORK_ITEMS_HREF }, { text: id }]
    })
    .code(statusCodes.badGateway)
}

/**
 * The confirm page's view model. `errorSummary` / `fieldError` for an
 * unticked box, `failureBanner` for a backend failure.
 */
function pageView(
  workItem,
  { errorSummary = null, fieldError = null, failureBanner = null } = {}
) {
  const id = workItem.id
  const applicationRef = workItem.payload?.applicationReference ?? null
  const hasError = errorSummary !== null || failureBanner !== null
  return {
    pageTitle: hasError ? `Error: ${PAGE_TITLE}` : PAGE_TITLE,
    heading: PAGE_TITLE,
    caption: applicationRef ? `Application number: ${applicationRef}` : null,
    breadcrumbs: [
      { text: 'Work items', href: WORK_ITEMS_HREF },
      { text: applicationRef ?? 'Work item', href: detailHref(id) },
      { text: PAGE_TITLE }
    ],
    formAction: confirmContactHref(id),
    cancelHref: detailHref(id),
    fieldId: CONFIRM_FIELD_ID,
    errorSummary,
    fieldError,
    failureBanner
  }
}

/**
 * Loads the work item and settles the cases where there is no page to show.
 * Returns `{ response }` to hand straight back, or `{ workItem }`.
 */
async function loadPendingWorkItem(request, h, user) {
  const id = request.params.id
  const result = await getWorkItem({ workItemId: id, user })

  if (result.ok === false && result.status === statusCodes.notFound) {
    return { response: renderNotFound(h, id) }
  }
  if (!result.ok) {
    return { response: renderUnavailable(h, id, result) }
  }

  // Guard the ROUTE, not just the button: this URL is guessable and
  // bookmarkable, and the item may have moved on since the detail page was
  // rendered (including a confirmation that already landed).
  if (!isPendingContact(result.workItem)) {
    return { response: h.redirect(detailHref(id)) }
  }

  return { workItem: result.workItem }
}

function failureBannerFor(result) {
  if (result.outcome === 'conflict') {
    return {
      title: FAILED_TITLE,
      text: 'This application has changed since you opened it. Refresh and try again.'
    }
  }
  return {
    title: FAILED_TITLE,
    text: 'There was a problem confirming applicant contact. Nothing has been changed. Try again.'
  }
}

/**
 * GET — render the confirm page.
 */
export function makeShowConfirmContactController() {
  return {
    async handler(request, h) {
      const { response, workItem } = await loadPendingWorkItem(
        request,
        h,
        getUser(request)
      )
      if (response) {
        return response
      }
      return h.view(VIEW_PATH, pageView(workItem))
    }
  }
}

/**
 * POST — confirm contact. Redirects on success and for an item no longer
 * pending contact; re-renders in place for an unticked box or a failure.
 */
export function makeSubmitConfirmContactController({
  service = createConfirmContactService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)

      const { response, workItem } = await loadPendingWorkItem(request, h, user)
      if (response) {
        return response
      }

      if (request.payload?.[CONFIRM_FIELD_ID] !== 'yes') {
        return h
          .view(
            VIEW_PATH,
            pageView(workItem, {
              errorSummary: {
                titleText: 'There is a problem',
                items: [
                  {
                    text: MISSING_CONFIRMATION_MESSAGE,
                    href: `#${CONFIRM_FIELD_ID}`
                  }
                ]
              },
              fieldError: MISSING_CONFIRMATION_MESSAGE
            })
          )
          .code(statusCodes.badRequest)
      }

      const result = await service.confirmApplicantContact({
        workItemId: id,
        user
      })

      if (result.ok) {
        const banner = SUCCESS_BANNERS[workItem.stateId]
        if (banner) {
          request.yar?.flash?.('flashBanner', banner)
        }
        return h.redirect(detailHref(id))
      }

      logger.warn(
        {
          workItemId: id,
          outcome: result.outcome,
          status: result.status,
          message: result.message
        },
        'Confirming re-accreditation applicant contact failed'
      )
      return h
        .view(
          VIEW_PATH,
          pageView(workItem, { failureBanner: failureBannerFor(result) })
        )
        .code(
          result.outcome === 'conflict'
            ? statusCodes.conflict
            : statusCodes.badGateway
        )
    }
  }
}
