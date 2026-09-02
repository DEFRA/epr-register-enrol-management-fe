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
 * Redirect and banner mechanics live in `../onward-hop.js`, shared with
 * Continue review. Only the copy is here.
 */

import { makeOnwardHopHandler } from '../onward-hop.js'

import { createPaymentReceivedService } from './service.js'

// Names the destination, unlike the Continue review banner, which
// deliberately does not: there the backend resolves one of four possible
// target states from audit history, so the copy would have to guess. Here
// there is exactly one target, so saying it is both safe and necessary —
// `assessment-in-progress` and `updated` share the display name "Updated"
// (RA-324 AC06), so the state tag will NOT visibly change when the button
// is pressed, and this banner is the only feedback that anything happened.
const BANNERS = {
  success: {
    type: 'success',
    title: 'Payment received',
    text: 'The application has moved to assessment.'
  },
  failureTitle: 'Could not record payment received',
  conflict:
    'This application can no longer be moved on from its current state. Refresh and try again.',
  notFound: 'This application could not be found.',
  fallback:
    'There was a problem recording the payment for this application. Try again.'
}

/**
 * POST — record that the query response carried the payment. Always
 * redirects to the detail page.
 */
export function makePaymentReceivedController({
  service = createPaymentReceivedService()
} = {}) {
  return {
    handler: makeOnwardHopHandler({
      apply: (args) => service.recordPaymentReceived(args),
      banners: BANNERS,
      logMessage: 'Re-accreditation payment received failed'
    })
  }
}
