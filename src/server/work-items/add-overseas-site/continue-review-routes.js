/**
 * RA-698. Add-ORS continue-review: the way out of `updated` once the operator
 * has answered a query. Reuses the re-accreditation controller (body-less
 * POST, PRG redirect to the detail page); only the backend call differs: the
 * type-less `POST /work-items/{id}/continue-review`.
 */

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'
import { continueReviewWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'

import { makeContinueReviewController } from '../re-accreditation/continue-review/controller.js'
import { createContinueReviewService } from '../re-accreditation/continue-review/service.js'
import { ADD_OVERSEAS_SITE_TYPE_ID } from './type-id.js'

export function buildAddOverseasSiteContinueReviewRoutes() {
  return [
    {
      method: 'POST',
      path: `/work-items/${ADD_OVERSEAS_SITE_TYPE_ID}/{id}/continue-review`,
      options: {
        ...requireStandard,
        payload: {
          parse: true,
          allow: 'application/x-www-form-urlencoded',
          maxBytes: 10 * 1024
        }
      },
      ...makeContinueReviewController({
        service: createContinueReviewService({
          continueReview: (args) => continueReviewWorkItem(args)
        })
      })
    }
  ]
}
