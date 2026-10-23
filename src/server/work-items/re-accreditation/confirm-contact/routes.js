/**
 * Routes for the re-accreditation confirm-contact flow (RA-527, step 2 of
 * the two-step determination).
 *
 * The module's `register(server)` callback mounts these. GET and POST both
 * live at `/work-items/re-accreditation/{id}/confirm-contact` so the form can
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

import {
  makeShowConfirmContactController,
  makeSubmitConfirmContactController
} from './controller.js'

export const CONFIRM_CONTACT_PATH =
  '/work-items/re-accreditation/{id}/confirm-contact'

export function buildConfirmContactRoutes() {
  return [
    {
      method: 'GET',
      path: CONFIRM_CONTACT_PATH,
      ...makeShowConfirmContactController()
    },
    {
      method: 'POST',
      path: CONFIRM_CONTACT_PATH,
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          // One checkbox and the crumb.
          maxBytes: 10 * 1024
        }
      },
      ...makeSubmitConfirmContactController()
    }
  ]
}
