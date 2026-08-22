import { GetObjectCommand } from '@aws-sdk/client-s3'

import { config } from '#/config/config.js'
import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { s3Client } from '#/server/common/helpers/s3-client.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Streams a sampling-plan or BES-evidence file straight from S3 (RA-254-ish
 * follow-up: download on the case-management side). Mirrors DEFRA's
 * cdp-example-node-frontend file-controller pattern — direct S3 access, not
 * cdp-uploader (upload/scan only).
 *
 * Access control: this hits the same `getWorkItem` backend endpoint the
 * application-details page already uses, which 404s for a non-existent
 * work item id. There is no per-caseworker ownership check here — per
 * ADR-0005, `WorkItemTenancy`/`CanRead` was deliberately deleted from the
 * backend, and by design (RA-323) every caseworker holds the same role and
 * can see every case. No separate ownership check is written here on
 * purpose — this matches the system's documented "any caseworker sees any
 * case" model, not an oversight.
 */

function findFile(payload, fileId) {
  const samplingPlanFiles = payload?.samplingPlan?.files
  const fromSamplingPlan = Array.isArray(samplingPlanFiles)
    ? samplingPlanFiles.find((f) => f.fileId === fileId)
    : undefined
  if (fromSamplingPlan) {
    return fromSamplingPlan
  }

  const sites = payload?.overseasSites?.sites
  if (!Array.isArray(sites)) {
    return undefined
  }

  for (const site of sites) {
    const besFiles = site?.besEvidence?.files
    const found = Array.isArray(besFiles)
      ? besFiles.find((f) => f.fileId === fileId)
      : undefined
    if (found) {
      return found
    }
  }
  return undefined
}

export const workItemDownloadFileController = {
  async handler(request, h) {
    const { id, fileId } = request.params
    const user = request.auth?.credentials

    const result = await getWorkItem({ workItemId: id, user })
    if (!result.ok) {
      return h.response('Not found').code(404)
    }

    const file = findFile(result.workItem?.payload, fileId)

    if (!file || !file.s3Key) {
      return h.response('File not found').code(404)
    }

    if (file.scanStatus !== 'Clean') {
      return h
        .response(
          'File is not available for download: scan status is not clean.'
        )
        .code(422)
    }

    const bucket = file.s3Bucket || config.get('fileStorage.fallbackBucket')

    try {
      const response = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: file.s3Key })
      )

      return h
        .response(response.Body)
        .header(
          'Content-Type',
          response.ContentType || file.contentType || 'application/octet-stream'
        )
        .header(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(file.filename || file.fileId)}"`
        )
        .code(200)
    } catch (err) {
      logger.error({ err, workItemId: id, fileId }, 'S3 download failed')
      return h.response('File not found').code(404)
    }
  }
}
