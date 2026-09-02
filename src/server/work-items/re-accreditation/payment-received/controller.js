/**
 * Re-accreditation payment-received controller (RA-523).
 *
 * One handler, POST-only, at
 * `/work-items/re-accreditation/{id}/payment-received`.
 *
 * The CTA that posts here is a plain button in the detail page's action
 * panel, not a confirmation interstitial: recording that the query response
 * carried the payment is the ordinary forward path out of `updated` for a
 * `duly-made`-origin item, it takes no user input, and it is neither
 * destructive nor a determination. Same class as the Continue review button
 * it replaces on that one screen.
 *
 * ⚠ This bespoke route is the ONLY way to apply
 * `payment-received-during-duly-made`, and that is a security boundary, not
 * a stylistic choice. The transition shares `fromStateId: 'updated'` with
 * all four `continue-review-during-*` transitions, so the engine's
 * from-state guard cannot tell them apart. It is declared
 * `callerInvocable: false` precisely so the generic
 * `/work-items/{id}/actions/{actionId}` route refuses it: were it
 * invocable, a caller holding a `submitted`-origin item in `updated` could
 * fire it and skip duly making entirely — no payment date captured and
 * therefore no SLA clock ever started. management-be resolves the origin
 * from the item's own audit history and refuses anything that is not
 * `duly-made`. Confirmed with the management-be owner.
 *
 * Every branch PRG-redirects back to the work item detail page with a flash
 * banner, so a refresh never re-posts and the user always lands on the page
 * showing the (backend-resolved) new state.
 */

import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import { createPaymentReceivedService } from './service.js'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

/**
 * POST — record that the query response carried the payment. Always
 * redirects to the detail page.
 */
export function makePaymentReceivedController({
  service = createPaymentReceivedService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)

      const result = await service.recordPaymentReceived({
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
        'Re-accreditation payment received failed'
      )
      flashBanner(request, bannerForFailure(result))
      return h.redirect(detailHref(id))
    }
  }
}

// Names the destination, unlike the Continue review banner, which
// deliberately does not: there the backend resolves one of four possible
// target states from audit history, so the copy would have to guess. Here
// there is exactly one target, so saying it is both safe and useful — the
// state TAG will not tell the case worker, since `assessment-in-progress`
// and `updated` share the display name "Updated" (RA-324 AC06), so the
// page's own status will not visibly change when they press it.
const SUCCESS_BANNER = {
  type: 'success',
  title: 'Payment received',
  text: 'The application has moved to assessment.'
}

const FAILURE_TITLE = 'Could not record payment received'

function bannerForFailure(result) {
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title: FAILURE_TITLE,
      text: 'This application can no longer be moved on from its current state. Refresh and try again.'
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
    text: 'There was a problem recording the payment for this application. Try again.'
  }
}
