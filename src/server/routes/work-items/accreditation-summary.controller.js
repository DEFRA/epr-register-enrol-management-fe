import { config } from '#/config/config.js'
import {
  getAccreditationSummary,
  getWorkItem
} from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import {
  ACCREDITATION_SUMMARY_TAB_KEY,
  buildCaseHeader,
  buildCaseTabs,
  decorateForCaseHeader
} from './case-header.js'
import { renderFetchErrorUnlessCaseHasTab } from './work-item-fetch-errors.js'
import {
  ACCREDITATION_SUMMARY_HEADING,
  ACCREDITATION_SUMMARY_INTRO,
  ACCREDITATION_SUMMARY_UNAVAILABLE,
  buildAccreditationSummary
} from './accreditation-summary.js'

const VIEW = 'work-items/accreditation-summary'

/**
 * RA-769. The Accreditation summary tab of an In-Year Change case: the
 * accreditation as it stands today, read live through management-be on every
 * visit. Information only: the case header and tab strip, no assignment panel
 * and no case actions.
 *
 * When there is nothing to show (a registration-only case, an accreditation
 * that is not found or not Approved) or the read fails for any reason, the
 * header and tabs stay and the tab says the summary is not available. A work
 * item that cannot be found, or whose type's case lacks the tab
 * (re-accreditation), is not found as for every other tab page.
 */
export const workItemAccreditationSummaryController = {
  async handler(request, h) {
    const id = request.params.id
    const user = getUser(request)
    const result = await getWorkItem({ workItemId: id, user })

    const errorResponse = renderFetchErrorUnlessCaseHasTab({
      h,
      result,
      id,
      tab: ACCREDITATION_SUMMARY_TAB_KEY
    })
    if (errorResponse) {
      return errorResponse
    }

    const read = await getAccreditationSummary({ workItemId: id, user })
    const summary = read.ok && read.accreditation ? read : null

    const multipleInterimSitesEnabled = config.get(
      'featureFlags.multipleInterimSitesEnabled'
    )
    const forHeader = decorateForCaseHeader(result.workItem)
    return h.view(VIEW, {
      pageTitle: `Accreditation summary — ${forHeader.payload?.applicationReference ?? forHeader.id}`,
      caseHeader: buildCaseHeader({ workItem: forHeader }),
      caseTabs: buildCaseTabs({
        workItemId: forHeader.id,
        active: ACCREDITATION_SUMMARY_TAB_KEY,
        typeId: forHeader.typeId
      }),
      heading: ACCREDITATION_SUMMARY_HEADING,
      intro: ACCREDITATION_SUMMARY_INTRO,
      unavailableMessage: ACCREDITATION_SUMMARY_UNAVAILABLE,
      multipleInterimSitesEnabled,
      accreditationSummary: summary
        ? buildAccreditationSummary({ ...summary, multipleInterimSitesEnabled })
        : null
    })
  }
}
