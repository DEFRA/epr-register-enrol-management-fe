import {
  getRelatedWorkItems,
  getWorkItem
} from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import {
  ACCREDITATION_SUMMARY_REGISTRATION_ONLY,
  ACCREDITATION_SUMMARY_UNAVAILABLE,
  buildAccreditationBrief
} from './accreditation-summary.js'
import { readAccreditationSummary } from './read-accreditation-summary.js'
import {
  RELATED_REQUESTS_TAB_KEY,
  buildCaseHeader,
  buildCaseTabs,
  decorateForCaseHeader
} from './case-header.js'
import {
  ACCREDITATION_HEADING,
  RELATED_REQUESTS_UNAVAILABLE,
  buildRelatedRequests,
  requestedPage
} from './related-requests.js'
import { renderFetchErrorUnlessCaseHasTab } from './work-item-fetch-errors.js'

const VIEW = 'work-items/related-requests'

const logger = createLogger()

/**
 * RA-770. The Related change requests tab of an In-Year Change case: the
 * accreditation the request is for (number, status, start date and year, as
 * on the Accreditation summary tab), then the requests submitted with this
 * one, a page at a time (`?page=`). Both are read through management-be on
 * every visit, side by side (a registration-only request has no accreditation,
 * so only the requests are read). Information only: the case header and tab
 * strip, no assignment panel and no case actions.
 *
 * Either read failing leaves the header, tabs and the other part, and says
 * that part is not available. A work item that cannot be found, or whose
 * type's case lacks the tab (re-accreditation), is not found as for every
 * other tab page.
 */
export const workItemRelatedRequestsController = {
  async handler(request, h) {
    const id = request.params.id
    const user = getUser(request)
    const result = await getWorkItem({ workItemId: id, user })

    const errorResponse = renderFetchErrorUnlessCaseHasTab({
      h,
      result,
      id,
      tab: RELATED_REQUESTS_TAB_KEY
    })
    if (errorResponse) {
      return errorResponse
    }

    const [accreditation, read] = await Promise.all([
      readAccreditationSummary({ workItem: result.workItem, user }),
      getRelatedWorkItems({
        workItemId: id,
        page: requestedPage(request.query?.page),
        user
      })
    ])
    if (!read.ok) {
      logger.warn(
        {
          workItemId: id,
          status: read.status,
          unusable: read.unusable === true,
          error: read.error
        },
        'Related requests not available'
      )
    }

    const forHeader = decorateForCaseHeader(result.workItem)
    return h.view(VIEW, {
      pageTitle: `Related change requests — ${forHeader.payload?.applicationReference ?? forHeader.id}`,
      caseHeader: buildCaseHeader({ workItem: forHeader }),
      caseTabs: buildCaseTabs({
        workItemId: forHeader.id,
        active: RELATED_REQUESTS_TAB_KEY,
        typeId: forHeader.typeId,
        relatedCount: forHeader.payload?.submissionSize
      }),
      accreditationHeading: ACCREDITATION_HEADING,
      accreditationRows: accreditation.summary
        ? buildAccreditationBrief(accreditation.summary)
        : null,
      accreditationUnavailableMessage: accreditation.registrationOnly
        ? ACCREDITATION_SUMMARY_REGISTRATION_ONLY
        : ACCREDITATION_SUMMARY_UNAVAILABLE,
      relatedUnavailableMessage: RELATED_REQUESTS_UNAVAILABLE,
      relatedRequests: read.ok
        ? buildRelatedRequests({
            related: read.related,
            basePath: `/work-items/${encodeURIComponent(forHeader.id)}/${RELATED_REQUESTS_TAB_KEY}`
          })
        : null
    })
  }
}
