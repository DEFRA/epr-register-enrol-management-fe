import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  raiseWorkItemQuery: vi.fn()
}))

vi.mock('#/server/common/helpers/s3-client.js', () => ({
  s3Client: { send: vi.fn() }
}))

const { getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')
const { s3Client } = await import('#/server/common/helpers/s3-client.js')

const ID = '11111111-1111-1111-1111-111111111111'
const FILE_ID = 'sampling-plan-001'

function aWorkItem(samplingPlanFiles) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    payload: {
      applicationReference: 'RA-000000001',
      samplingPlan: { files: samplingPlanFiles }
    }
  }
}

function registerReaccreditation() {
  registerWorkItemType({
    id: 're-accreditation',
    displayName: 'Re-accreditation',
    initialState: { id: 'submitted', displayName: 'Submitted' },
    states: [{ id: 'submitted', displayName: 'Submitted' }],
    getTasksForState: () => []
  })
}

describe('#workItemDownloadFileController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItem.mockReset()
    s3Client.send.mockReset()
    clearWorkItemRegistry()
    registerReaccreditation()
  })

  test('streams the file with the right headers when the file is Clean', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem([
        {
          fileId: FILE_ID,
          filename: 'sampling-plan.pdf',
          contentType: 'application/pdf',
          scanStatus: 'Clean',
          s3Key: 'sampling-plans/full-payload-verification/sampling-plan.pdf',
          s3Bucket: 'epr-register-enrol-sampling-plans'
        }
      ])
    })
    s3Client.send.mockResolvedValue({
      Body: 'pdf-bytes',
      ContentType: 'application/pdf'
    })

    const { statusCode, result, headers } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/files/${FILE_ID}/download`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toBe('pdf-bytes')
    expect(headers['content-type']).toContain('application/pdf')
    expect(headers['content-disposition']).toContain('sampling-plan.pdf')
  })

  test('falls back to fileStorage.fallbackBucket when the file record has no s3Bucket', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem([
        {
          fileId: FILE_ID,
          filename: 'sampling-plan.pdf',
          contentType: 'application/pdf',
          scanStatus: 'Clean',
          s3Key: 'sampling-plans/full-payload-verification/sampling-plan.pdf'
        }
      ])
    })
    s3Client.send.mockResolvedValue({
      Body: 'pdf-bytes',
      ContentType: 'application/pdf'
    })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/files/${FILE_ID}/download`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(s3Client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'epr-register-enrol-file-uploads'
        })
      })
    )
  })

  test('returns 404 when the work item is not visible to the caller', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/files/${FILE_ID}/download`
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('returns 404 when no file on the work item matches fileId', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem([
        {
          fileId: 'some-other-file',
          filename: 'other.pdf',
          scanStatus: 'Clean',
          s3Key: 'sampling-plans/other.pdf'
        }
      ])
    })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/files/${FILE_ID}/download`
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('returns 422 when the file has not passed a Clean scan', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem([
        {
          fileId: FILE_ID,
          filename: 'sampling-plan.pdf',
          scanStatus: 'Infected',
          s3Key: 'sampling-plans/full-payload-verification/sampling-plan.pdf'
        }
      ])
    })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/files/${FILE_ID}/download`
    })

    expect(statusCode).toBe(422)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('returns 404 when the S3 fetch fails', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem([
        {
          fileId: FILE_ID,
          filename: 'sampling-plan.pdf',
          scanStatus: 'Clean',
          s3Key: 'sampling-plans/full-payload-verification/sampling-plan.pdf'
        }
      ])
    })
    s3Client.send.mockRejectedValue(new Error('NoSuchKey'))

    const { statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/files/${FILE_ID}/download`
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })
})
