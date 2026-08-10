/**
 * Routes for the re-accreditation continue-review flow (RA-372).
 *
 * The module's `register(server)` callback mounts this on the framework
 * server. POST only — there is no interstitial and nothing to GET; the
 * detail page's CTA posts straight here.
 *
 * `requireStandard` mirrors the backend, which protects the endpoint with
 * plain `.RequireAuthorization()` — any authenticated case worker may
 * continue a review, there is no `assign` role and no assigned-officer
 * check. The backend stays authoritative: a forged POST from a state that
 * cannot be continued is still rejected there with a 409.
 */

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

import { makeContinueReviewController } from './controller.js'

export function buildContinueReviewRoutes() {
  return [
    {
      method: 'POST',
      path: '/work-items/re-accreditation/{id}/continue-review',
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: 10 * 1024
        }
      },
      ...makeContinueReviewController()
    }
  ]
}
