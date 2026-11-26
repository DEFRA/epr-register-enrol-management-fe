/**
 * Routes for the Standard-lifecycle change-valid-from flow (RA-800).
 *
 * GET and POST both live at `/work-items/{typeId}/{id}/change-valid-from` so
 * the form posts back to its own URL. Mounted from a type's module via
 * `../routes.js#buildStandardLifecycleRoutes`.
 *
 * `requireStandard` mirrors the backend, which protects the endpoint with
 * plain authorisation only. It also keeps a read-only support user out: the
 * inert link is the affordance, this is the enforcement.
 */

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

import { CHANGE_VALID_FROM_PAGE, lifecycleRoutePath } from '../lifecycle.js'
import {
  makeShowChangeValidFromController,
  makeSubmitChangeValidFromController
} from './controller.js'

const MAX_BODY_BYTES = 20_480 // 20 KiB

/**
 * @param {string} typeId
 * @param {{ service?: object }} [options] the POST's service, for tests
 */
export function buildChangeValidFromRoutes(typeId, { service } = {}) {
  const path = lifecycleRoutePath(typeId, CHANGE_VALID_FROM_PAGE)
  return [
    {
      method: 'GET',
      path,
      options: requireStandard,
      ...makeShowChangeValidFromController({ typeId })
    },
    {
      method: 'POST',
      path,
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: MAX_BODY_BYTES
        }
      },
      ...makeSubmitChangeValidFromController({ typeId, service })
    }
  ]
}
