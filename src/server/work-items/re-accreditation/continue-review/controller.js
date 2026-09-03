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
 * user input, and it is neither destructive nor a determination.
 *
 * RA-523 note: the CTA no longer renders for a `duly-made` origin, which
 * the backend now retargets straight to assessment (it never reaches
 * `updated`). The ROUTE is unchanged and still accepts every origin the
 * backend does — only what the page offers changed.
 *
 * Redirect and banner mechanics used to live in a shared `../onward-hop.js`
 * factory. RA-523 deleted the sibling flow that shared it, so it has been
 * folded back here as a plain handler.
 *
 * Every branch PRG-redirects to the detail page, so a refresh never
 * re-posts and the caller always lands on the page showing the
 * (backend-resolved) new state — including on failure, where a dead-end
 * error page would lose them the item they were working on.
 */

import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import { createContinueReviewService } from './service.js'

const logger = createLogger()

// The backend does NOT tell us which state the item landed in ahead of
// time (it is resolved from audit history), and the redirect target
// re-renders the envelope anyway — so the banner deliberately describes
// the outcome without naming a state it would have to guess at.
const BANNERS = {
  success: {
    type: 'success',
    title: 'Review continued',
    text: 'The application has returned to the stage it was queried from. Any outstanding tasks are available to complete.'
  },
  failureTitle: 'Could not continue the review',
  conflict:
    'This application can no longer be continued from its current state. Refresh and try again.',
  notFound: 'This application could not be found.',
  fallback: 'There was a problem continuing this review. Try again.'
}

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function bannerForFailure(result) {
  const text =
    {
      conflict: BANNERS.conflict,
      'not-found': BANNERS.notFound
    }[result.outcome] ?? BANNERS.fallback

  return { type: 'error', title: BANNERS.failureTitle, text }
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
        request.yar?.flash?.('flashBanner', BANNERS.success)
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
      request.yar?.flash?.('flashBanner', bannerForFailure(result))
      return h.redirect(detailHref(id))
    }
  }
}
