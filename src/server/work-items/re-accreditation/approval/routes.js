/**
 * Routes for the re-accreditation approve-determination flow (RA-132).
 *
 * The module's `register(server)` callback mounts these on the framework
 * server. GET and POST both live at
 * `/work-items/re-accreditation/{id}/approve` so the interstitial
 * `<form>` can post back to its own URL.
 */

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

import {
  makeShowApprovalController,
  makeSubmitApprovalController
} from './controller.js'

export function buildApprovalRoutes() {
  return [
    {
      method: 'GET',
      path: '/work-items/re-accreditation/{id}/approve',
      options: requireStandard,
      ...makeShowApprovalController()
    },
    {
      method: 'POST',
      path: '/work-items/re-accreditation/{id}/approve',
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: 10 * 1024
        }
      },
      ...makeSubmitApprovalController()
    }
  ]
}
