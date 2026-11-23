import {
  getAccreditationSummary,
  getWorkItem
} from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { serveFile } from './download-file.controller.js'
import { ACCREDITATION_SUMMARY_TAB_KEY, caseHasTab } from './case-header.js'
import {
  ACCREDITATION_SUMMARY_UNAVAILABLE,
  summaryFiles
} from './accreditation-summary.js'

/**
 * RA-769. Downloads a sampling plan or BES evidence file from the
 * Accreditation summary tab of an In-Year Change case.
 *
 * Unlike the payload-based download (which finds the file in what the case was
 * submitted with), this reads the accreditation afresh from the operator
 * backend on every request and serves a file only if it is among the live
 * summary's files. A file that has since left the accreditation, or that
 * belongs to a site that is not on it (such as a requested ORS not yet
 * granted), is a 404. The S3 location comes from that fresh read and is never
 * sent to the browser or taken from the request.
 *
 * Outcomes: 404 for an unknown work item, a case without the tab, an
 * accreditation that is not there, or a file that is not in it; 503 when the
 * live read fails, so no file is served; 422 for a file that has not passed
 * its scan; 404 when S3 fails. Access follows the documented model that any
 * caseworker can read any case (ADR-0005), as for the payload-based download.
 */
export const workItemAccreditationSummaryDownloadController = {
  async handler(request, h) {
    const { id, fileId } = request.params
    const user = getUser(request)

    const result = await getWorkItem({ workItemId: id, user })
    if (
      !result.ok ||
      !caseHasTab(
        getWorkItemType(result.workItem?.typeId),
        ACCREDITATION_SUMMARY_TAB_KEY
      )
    ) {
      return h.response('Not found').code(statusCodes.notFound)
    }

    const read = await getAccreditationSummary({ workItemId: id, user })
    if (!read.ok && read.status === statusCodes.notFound) {
      return h.response('File not found').code(statusCodes.notFound)
    }
    if (!read.ok || !read.accreditation) {
      return h
        .response(ACCREDITATION_SUMMARY_UNAVAILABLE)
        .code(statusCodes.serviceUnavailable)
    }

    const file = summaryFiles(read.accreditation).find(
      (candidate) => candidate?.fileId === fileId
    )

    return serveFile({ h, file, workItemId: id })
  }
}
