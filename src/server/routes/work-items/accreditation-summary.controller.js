import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import {
  ACCREDITATION_SUMMARY_TAB_KEY,
  buildCaseHeader,
  buildCaseTabs,
  decorateForCaseHeader
} from './case-header.js'
import { renderFetchErrorUnlessCaseHasTab } from './work-item-fetch-errors.js'
import { readAccreditationSummary } from './read-accreditation-summary.js'
import {
  ACCREDITATION_SUMMARY_HEADING,
  ACCREDITATION_SUMMARY_INTRO,
  ACCREDITATION_SUMMARY_REGISTRATION_ONLY,
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
 * A registration-only case has no accreditation, so the tab says so and the
 * backend is not asked. When there is nothing else to show (an accreditation
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

    const { registrationOnly, summary } = await readAccreditationSummary({
      workItem: result.workItem,
      user
    })

    const forHeader = decorateForCaseHeader(result.workItem)
    return h.view(VIEW, {
      pageTitle: `Accreditation summary — ${forHeader.payload?.applicationReference ?? forHeader.id}`,
      caseHeader: buildCaseHeader({ workItem: forHeader }),
      caseTabs: buildCaseTabs({
        workItemId: forHeader.id,
        active: ACCREDITATION_SUMMARY_TAB_KEY,
        typeId: forHeader.typeId,
        relatedCount: forHeader.payload?.submissionSize
      }),
      heading: ACCREDITATION_SUMMARY_HEADING,
      intro: ACCREDITATION_SUMMARY_INTRO,
      unavailableMessage: registrationOnly
        ? ACCREDITATION_SUMMARY_REGISTRATION_ONLY
        : ACCREDITATION_SUMMARY_UNAVAILABLE,
      accreditationSummary: summary
        ? buildAccreditationSummary({ ...summary, workItemId: id })
        : null
    })
  }
}
