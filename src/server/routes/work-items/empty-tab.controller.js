import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import {
  RELATED_APPLICATIONS_TAB_KEY,
  buildCaseHeader,
  buildCaseTabs,
  decorateForCaseHeader
} from './case-header.js'
import { renderFetchErrorUnlessCaseHasTab } from './work-item-fetch-errors.js'

const EMPTY_TAB_VIEW = 'work-items/empty-tab'

/**
 * RA-495. A case tab whose content a later ticket builds (only Related
 * applications now: RA-769 gave Accreditation summary its own controller): the case header
 * and tab strip with the tab active, and an empty panel. Like the other tab
 * pages it is its own bookmarkable page, and it is not found for a work item
 * whose type's case lacks the tab (re-accreditation).
 *
 * @param {object} args
 * @param {string} args.tabKey the tab's key (also its path segment)
 * @param {string} args.title the tab's name, for the page title
 */
function makeEmptyTabController({ tabKey, title }) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const result = await getWorkItem({ workItemId: id, user })

      const errorResponse = renderFetchErrorUnlessCaseHasTab({
        h,
        result,
        id,
        tab: tabKey
      })
      if (errorResponse) {
        return errorResponse
      }

      const forHeader = decorateForCaseHeader(result.workItem)
      return h.view(EMPTY_TAB_VIEW, {
        pageTitle: `${title} — ${forHeader.payload?.applicationReference ?? forHeader.id}`,
        caseHeader: buildCaseHeader({ workItem: forHeader }),
        caseTabs: buildCaseTabs({
          workItemId: forHeader.id,
          active: tabKey,
          typeId: forHeader.typeId
        }),
        tabKey
      })
    }
  }
}

/** Related applications: RA-770 fills it. */
export const workItemRelatedApplicationsController = makeEmptyTabController({
  tabKey: RELATED_APPLICATIONS_TAB_KEY,
  title: 'Related applications'
})
