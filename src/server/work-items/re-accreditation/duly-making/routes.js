/**
 * Routes for the re-accreditation duly-making flow (RA-316).
 *
 * The module's `register(server)` callback mounts these. GET and POST both
 * live at `/work-items/re-accreditation/{id}/duly-make` so the form can
 * post back to its own URL — the same shape as the approve pair.
 *
 * Namespaced under `/work-items/re-accreditation/` rather than the generic
 * `/work-items/{id}/...` because this page is type-specific: it renders
 * re-accreditation payload fields and posts to a type-specific backend
 * endpoint.
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

import {
  makeShowDulyMakingController,
  makeSubmitDulyMakingController
} from './controller.js'

export function buildDulyMakingRoutes() {
  return [
    {
      method: 'GET',
      path: '/work-items/re-accreditation/{id}/duly-make',
      options: requireStandard,
      ...makeShowDulyMakingController()
    },
    {
      method: 'POST',
      path: '/work-items/re-accreditation/{id}/duly-make',
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: 10 * 1024
        }
      },
      ...makeSubmitDulyMakingController()
    }
  ]
}
