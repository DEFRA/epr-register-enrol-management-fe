import { S3Client } from '@aws-sdk/client-s3'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'

import { config } from '#/config/config.js'

/**
 * Direct S3 access for serving sampling-plan file downloads, mirroring
 * DEFRA's cdp-example-node-frontend reference (files/file-controller.js +
 * s3-client.js) — not cdp-uploader, which only handles the upload/scan
 * handshake. Credentials resolve via the default AWS provider chain (the
 * service's IAM role in deployed environments); the endpoint override only
 * applies locally, against floci.
 */
export const s3Client = new S3Client({
  credentials: fromNodeProviderChain(),
  ...(config.get('fileStorage.s3Endpoint') && {
    endpoint: config.get('fileStorage.s3Endpoint'),
    forcePathStyle: true
  })
})
