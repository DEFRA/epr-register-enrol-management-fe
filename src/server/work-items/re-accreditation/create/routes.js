import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'

import {
  makeCreateWorkItemController,
  makeSubmitCreateWorkItemController
} from './controller.js'

/**
 * Routes for the re-accreditation create-work-item form (RA-127).
 *
 * Caller registers these from the module's `register(server)` callback,
 * gated behind `featureFlags.workItemCreationEnabled`. When the flag is
 * off the routes are not mounted at all, so `GET`/`POST` return the
 * generic 404 page rather than a deliberate 403/feature-disabled page —
 * a hidden feature should be invisible.
 */
export function buildCreateWorkItemRoutes() {
  return [
    {
      method: 'GET',
      path: '/work-items/re-accreditation/new',
      options: requireStandard,
      ...makeCreateWorkItemController()
    },
    {
      method: 'POST',
      path: '/work-items/re-accreditation/new',
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: 10 * 1024
        }
      },
      ...makeSubmitCreateWorkItemController()
    }
  ]
}
