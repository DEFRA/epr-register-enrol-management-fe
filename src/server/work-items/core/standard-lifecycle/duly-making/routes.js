/**
 * Routes for the Standard-lifecycle duly-making flow (RA-316; shared since
 * RA-495).
 *
 * A type's module mounts these from its `register(server)` callback (see
 * `../routes.js#buildStandardLifecycleRoutes`). GET and POST both live at
 * `/work-items/{typeId}/{id}/duly-make` so the form can post back to its own
 * URL — the same shape as the approve pair.
 *
 * Namespaced under the type rather than the generic `/work-items/{id}/...`
 * because the page is the type's: it renders the payment details the type
 * supplies and posts to the type's backend endpoint.
 *
 * `requireStandard` mirrors the backend, which protects the endpoint with
 * plain authorisation — any authenticated case worker may duly make, the
 * same as `approve` and `continue-review`. There is deliberately NO
 * `assign`-role gate and no assigned-officer check: management-be confirmed
 * it does not use 403 on this endpoint at all, and adding a UI-only role
 * check the backend does not enforce would be security theatre that also
 * blocks legitimate users.
 */

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

import { DULY_MAKE_PAGE, lifecycleRoutePath } from '../lifecycle.js'
import {
  makeShowDulyMakingController,
  makeSubmitDulyMakingController
} from './controller.js'

/**
 * @param {string} typeId
 * @param {{ service?: object }} [options] the POST's service, for tests
 */
export function buildDulyMakingRoutes(typeId, { service } = {}) {
  const path = lifecycleRoutePath(typeId, DULY_MAKE_PAGE)
  return [
    {
      method: 'GET',
      path,
      options: requireStandard,
      ...makeShowDulyMakingController({ typeId })
    },
    {
      method: 'POST',
      path,
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: 10 * 1024
        }
      },
      ...makeSubmitDulyMakingController({ typeId, service })
    }
  ]
}
