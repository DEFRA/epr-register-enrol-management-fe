/**
 * Re-accreditation continue-review controller (RA-372).
 *
 * One handler, POST-only, at
 * `/work-items/re-accreditation/{id}/continue-review`.
 *
 * The CTA that posts here is a plain button in the detail page's action
 * panel, not a confirmation interstitial: continuing the review is the
 * ordinary forward path out of `updated` (the operator has answered the
 * query and the case worker wants the remaining tasks back), it takes no
 * user input, and it is neither destructive nor a determination. That puts
 * it in the same class as the generic `payment-received` /
 * `submit-for-decision` action buttons, which also post straight through.
 *
 * Every branch PRG-redirects back to the work item detail page with a
 * flash banner, so a refresh never re-posts and the user always lands on
 * the page that shows the (backend-resolved) new state and its tasks.
 */

import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import { createContinueReviewService } from './service.js'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

/**
 * POST — continue the review. Always redirects to the detail page.
 */
export function makeContinueReviewController({
  service = createContinueReviewService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)

      const result = await service.continueReviewOfWorkItem({
        workItemId: id,
        user
      })

      if (result.ok) {
        flashBanner(request, SUCCESS_BANNER)
        return h.redirect(detailHref(id))
      }

      // Log every non-success outcome so an unexpected 5xx still leaves a
      // breadcrumb even though the user only sees a generic banner.
      logger.warn(
        {
          workItemId: id,
          outcome: result.outcome,
          status: result.status,
          message: result.message
        },
        'Re-accreditation continue review failed'
      )
      flashBanner(request, bannerForFailure(result))
      return h.redirect(detailHref(id))
    }
  }
}

// The backend does NOT tell us which state the item landed in ahead of
// time (it is resolved from audit history), and the redirect target
// re-renders the envelope anyway — so the banner deliberately describes
// the outcome without naming a state it would have to guess at.
const SUCCESS_BANNER = {
  type: 'success',
  title: 'Review continued',
  text: 'The application has returned to the stage it was queried from. Any outstanding tasks are available to complete.'
}

const FAILURE_TITLE = 'Could not continue the review'

function bannerForFailure(result) {
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title: FAILURE_TITLE,
      text: 'This application can no longer be continued from its current state. Refresh and try again.'
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
    text: 'There was a problem continuing this review. Try again.'
  }
}
