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
 * now gets the straight-to-assessment hop instead. The ROUTE is unchanged
 * and still accepts every origin the backend does — only what the page
 * offers changed.
 *
 * Redirect and banner mechanics live in `../onward-hop.js`, shared with
 * that flow. Only the copy is here.
 */

import { makeOnwardHopHandler } from '../onward-hop.js'

import { createContinueReviewService } from './service.js'

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

/**
 * POST — continue the review. Always redirects to the detail page.
 */
export function makeContinueReviewController({
  service = createContinueReviewService()
} = {}) {
  return {
    handler: makeOnwardHopHandler({
      apply: (args) => service.continueReviewOfWorkItem(args),
      banners: BANNERS,
      logMessage: 'Re-accreditation continue review failed'
    })
  }
}
