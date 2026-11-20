/**
 * Routes for the Standard-lifecycle log-decision flow (RA-410; shared since
 * RA-495).
 *
 * A type's module mounts these from its `register(server)` callback (see
 * `../routes.js#buildStandardLifecycleRoutes`). GET and POST both
 * live at `/work-items/{typeId}/{id}/decision` so the radio form can
 * post back to its own URL — the same shape as the duly-make and approve
 * pairs before it.
 *
 * Namespaced under the type rather than the generic `/work-items/{id}/...`
 * because the page is the type's: it posts to the type's backend endpoint that resolves both lifecycle hops itself.
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

import { DECISION_PAGE, lifecycleRoutePath } from '../lifecycle.js'
import {
  makeShowDecisionController,
  makeSubmitDecisionController
} from './controller.js'

/**
 * @param {string} typeId
 * @param {{ service?: object }} [options] the POST's service, for tests
 */
export function buildDecisionRoutes(typeId, { service } = {}) {
  const path = lifecycleRoutePath(typeId, DECISION_PAGE)
  return [
    {
      method: 'GET',
      path,
      options: requireStandard,
      ...makeShowDecisionController({ typeId })
    },
    {
      method: 'POST',
      path,
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          // RA-203. Sized for the 2000-character decision note, not for the
          // radio. 10 KiB (what the approve interstitial used) is enough for
          // 2000 ASCII characters but NOT for 2000 multi-byte ones: UTF-8
          // plus percent-encoding can reach ~12 bytes per character, so a
          // legitimate note in a non-Latin script would 413. 32 KiB clears
          // the worst case with room to spare.
          maxBytes: 32 * 1024
        }
      },
      ...makeSubmitDecisionController({ typeId, service })
    }
  ]
}
