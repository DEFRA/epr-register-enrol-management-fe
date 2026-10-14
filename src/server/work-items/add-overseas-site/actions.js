import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { createAddOverseasSiteActionsService } from './service.js'

const logger = createLogger()

export function buildAddOverseasSiteRoutes({
  service = createAddOverseasSiteActionsService()
} = {}) {
  return ['start-assessment', 'refuse'].map((operation) => ({
    method: 'POST',
    path: `/work-items/add-overseas-site/{id}/${operation}`,
    options: {
      ...requireStandard,
      payload: {
        parse: true,
        allow: 'application/x-www-form-urlencoded',
        maxBytes: 10 * 1024
      }
    },
    async handler(request, h) {
      const act =
        operation === 'refuse' ? service.refuseRequest : service.startAssessment
      const result = await act({
        workItemId: request.params.id,
        user: getUser(request)
      })
      if (!result.ok) {
        logger.warn(
          { caseId: request.params.id, operation, outcome: result.outcome },
          'Add ORS operation unconfirmed'
        )
        request.yar.flash('flashBanner', {
          type: 'error',
          title:
            result.outcome === 'delivery-unconfirmed'
              ? 'Operator delivery unconfirmed'
              : 'Operation unconfirmed',
          text: 'Refresh the case to check its current state. If refusal delivery is unconfirmed, retry the recorded refusal.'
        })
      }
      return h.redirect(`/work-items/${encodeURIComponent(request.params.id)}`)
    }
  }))
}
