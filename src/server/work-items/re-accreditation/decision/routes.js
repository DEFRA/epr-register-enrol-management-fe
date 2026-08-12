/**
 * Routes for the re-accreditation log-decision flow (RA-410).
 *
 * The module's `register(server)` callback mounts these. GET and POST both
 * live at `/work-items/re-accreditation/{id}/decision` so the radio form can
 * post back to its own URL — the same shape as the duly-make and approve
 * pairs before it.
 *
 * Namespaced under `/work-items/re-accreditation/` rather than the generic
 * `/work-items/{id}/...` because this page is type-specific: it posts to a
 * type-specific backend endpoint that resolves both lifecycle hops itself.
 *
 * `requireStandard` mirrors the backend, which protects the endpoint with
 * plain authorisation — any authenticated case worker may log a decision.
 * There is deliberately NO `assign`-role gate and no assigned-officer check:
 * management-be confirmed `/decision` returns no 403 at all (RA-323 removed
 * the decision-maker role tier), and adding a UI-only role check the backend
 * does not enforce would be security theatre that also blocks legitimate
 * users. It DOES keep a read-only support user (RA-335) out, because such a
 * session never holds `ROLE_STANDARD` — the inert CTA is the affordance, and
 * this is the enforcement.
 */

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

import {
  makeShowDecisionController,
  makeSubmitDecisionController
} from './controller.js'

export function buildDecisionRoutes() {
  return [
    {
      method: 'GET',
      path: '/work-items/re-accreditation/{id}/decision',
      options: requireStandard,
      ...makeShowDecisionController()
    },
    {
      method: 'POST',
      path: '/work-items/re-accreditation/{id}/decision',
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: 10 * 1024
        }
      },
      ...makeSubmitDecisionController()
    }
  ]
}
