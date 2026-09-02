/**
 * Routes for the re-accreditation payment-received flow (RA-523).
 *
 * POST only, mirroring `continue-review/routes.js` — there is no
 * interstitial and nothing to GET; the detail page's CTA posts straight
 * here with an empty body.
 *
 * `requireStandard` mirrors the backend, which protects the endpoint with
 * plain authorisation: any authenticated case worker may record the
 * payment, there is no `assign` role and no assigned-officer check. The
 * backend stays authoritative — a forged POST from an item whose origin is
 * not `duly-made` is still rejected there with a 409.
 */

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

import { makePaymentReceivedController } from './controller.js'

export function buildPaymentReceivedRoutes() {
  return [
    {
      method: 'POST',
      path: '/work-items/re-accreditation/{id}/payment-received',
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: 10 * 1024
        }
      },
      ...makePaymentReceivedController()
    }
  ]
}
