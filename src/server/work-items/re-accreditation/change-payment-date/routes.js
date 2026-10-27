/**
 * Routes for the re-accreditation change-payment-date flow (RA-576).
 *
 * GET and POST both live at
 * `/work-items/re-accreditation/{id}/change-payment-date` so the form posts
 * back to its own URL. Namespaced under `/work-items/re-accreditation/`
 * because the page is type-specific.
 *
 * `requireStandard` mirrors the backend, which protects the endpoint with
 * plain authorisation only — the same as duly making.
 */

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

import {
  makeShowChangePaymentDateController,
  makeSubmitChangePaymentDateController
} from './controller.js'

export function buildChangePaymentDateRoutes() {
  return [
    {
      method: 'GET',
      path: '/work-items/re-accreditation/{id}/change-payment-date',
      options: requireStandard,
      ...makeShowChangePaymentDateController()
    },
    {
      method: 'POST',
      path: '/work-items/re-accreditation/{id}/change-payment-date',
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: 20 * 1024
        }
      },
      ...makeSubmitChangePaymentDateController()
    }
  ]
}
