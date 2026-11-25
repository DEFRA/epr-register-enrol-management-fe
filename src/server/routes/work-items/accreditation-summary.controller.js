import {
  getAccreditationSummary,
  getWorkItem
} from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  ACCREDITATION_SUMMARY_TAB_KEY,
  buildCaseHeader,
  buildCaseTabs,
  decorateForCaseHeader
} from './case-header.js'
import { renderFetchErrorUnlessCaseHasTab } from './work-item-fetch-errors.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import {
  ACCREDITATION_SUMMARY_HEADING,
  ACCREDITATION_SUMMARY_INTRO,
  ACCREDITATION_SUMMARY_REGISTRATION_ONLY,
  ACCREDITATION_SUMMARY_UNAVAILABLE,
  buildAccreditationSummary
} from './accreditation-summary.js'

const VIEW = 'work-items/accreditation-summary'

const logger = createLogger()

/**
 * Why a read gave nothing to show, for the log: every other such read renders
 * the same unavailable message, so the log is the only place the cases differ.
 */
function unavailableOutcome(read) {
  if (read?.status === statusCodes.notFound) {
    return '404'
  }
  return read?.unusable ? 'unusable body' : 'unavailable'
}

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

    // A type's case has an accreditation unless the type says this one does not
    // (add-ORS: a registration-only change).
    const registrationOnly =
      getWorkItemType(result.workItem?.typeId)?.hasAccreditation?.(
        result.workItem?.payload
      ) === false
    const read = registrationOnly
      ? null
      : await getAccreditationSummary({ workItemId: id, user })
    const summary = read?.ok && read.accreditation ? read : null
    if (!summary && !registrationOnly) {
      logger.warn(
        {
          workItemId: id,
          outcome: unavailableOutcome(read),
          status: read.status,
          error: read.error
        },
        'Accreditation summary not available'
      )
    }

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
      unavailableMessage: registrationOnly
        ? ACCREDITATION_SUMMARY_REGISTRATION_ONLY
        : ACCREDITATION_SUMMARY_UNAVAILABLE,
      accreditationSummary: summary
        ? buildAccreditationSummary({ ...summary, workItemId: id })
        : null
    })
  }
}
