/**
 * Routes for the Standard-lifecycle confirm-contact flow (RA-527, step 2 of
 * the two-step determination; shared since RA-495).
 *
 * A type's module mounts these from its `register(server)` callback (see
 * `../routes.js#buildStandardLifecycleRoutes`). GET and POST both
 * live at `/work-items/{typeId}/{id}/confirm-contact` so the form can
 * post back to its own URL, like the decision page.
 *
 * The GET is open to any signed-in user, so a read-only support user (RA-335)
 * sees the page with its controls disabled. The POST applies the outcome, so
 * it carries `requireStandard`, mirroring the backend's plain authorisation
 * on `/confirm-contact` (the same as `/decision`: any case worker, no
 * assigned-officer check). The backend stays authoritative: it answers 409 to
 * a forged POST for an item that is not pending contact.
 */

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

import { CONFIRM_CONTACT_PAGE, lifecycleRoutePath } from '../lifecycle.js'
import {
  makeShowConfirmContactController,
  makeSubmitConfirmContactController
} from './controller.js'

/**
 * @param {string} typeId
 * @param {{ service?: object }} [options] the POST's service, for tests
 */
export function buildConfirmContactRoutes(typeId, { service } = {}) {
  const path = lifecycleRoutePath(typeId, CONFIRM_CONTACT_PAGE)
  return [
    {
      method: 'GET',
      path,
      ...makeShowConfirmContactController({ typeId })
    },
    {
      method: 'POST',
      path,
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          // One checkbox and the crumb.
          maxBytes: 10 * 1024
        }
      },
      ...makeSubmitConfirmContactController({ typeId, service })
    }
  ]
}
