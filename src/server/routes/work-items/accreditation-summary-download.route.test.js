/**
 * RA-769. The Accreditation summary tab's file download: a fresh read of the
 * live summary on every request, serving only a file that is in it.
 *
 * Route-level: the real server, only the backend API and S3 mocked.
 */
import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

vi.mock(
  '#/server/common/helpers/backend-api/backend-api.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    getWorkItem: vi.fn(),
    getAccreditationSummary: vi.fn()
  })
)

vi.mock('#/server/common/helpers/s3-client.js', () => ({
  s3Client: { send: vi.fn() }
}))

const { getWorkItem, getAccreditationSummary } =
  await import('#/server/common/helpers/backend-api/backend-api.js')
const { s3Client } = await import('#/server/common/helpers/s3-client.js')

const ID = '76900007-0000-4000-8000-000000000001'
const RE_ACCREDITATION_ID = '76900007-0000-4000-8000-000000000002'

const download = (fileId, id = ID) =>
  `/work-items/${id}/accreditation-summary/files/${fileId}/download`

function aFile(fileId, overrides = {}) {
  return {
    fileId,
    filename: `${fileId}.pdf`,
    contentType: 'application/pdf',
    scanStatus: 'Clean',
    s3Key: `keys/${fileId}.pdf`,
    s3Bucket: 'live-bucket',
    ...overrides
  }
}

function aSummary(accreditation = {}) {
  return {
    ok: true,
    accreditation: {
      accreditationYear: 2026,
      material: 'plastic',
      wasteProcessingType: 'exporter',
      samplingPlan: { files: [aFile('sp-clean'), aFile('sp-pending')] },
      overseasSites: [
        {
          siteId: 1,
          orsId: '001',
          siteName: 'Speira GmbH',
          besEvidence: { files: [aFile('bes-clean')] }
        }
      ],
      ...accreditation
    },
    accreditationStartDate: '2026-01-01'
  }
}

describe('RA-769: Accreditation summary file download', () => {
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
    getAccreditationSummary.mockReset()
    s3Client.send.mockReset()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: { id: ID, typeId: 'add-overseas-site', stateId: 'submitted' }
    })
    getAccreditationSummary.mockResolvedValue(aSummary())
    s3Client.send.mockResolvedValue({
      Body: 'pdf-bytes',
      ContentType: 'application/pdf'
    })
  })

  const get = (url) => server.inject({ method: 'GET', url })

  test('streams a clean sampling plan file with its filename and content type', async () => {
    const { statusCode, result, headers } = await get(download('sp-clean'))

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toBe('pdf-bytes')
    expect(headers['content-type']).toContain('application/pdf')
    expect(headers['content-disposition']).toBe(
      'attachment; filename="sp-clean.pdf"'
    )
  })

  test('streams a clean BES evidence file of a site on the live accreditation', async () => {
    const { statusCode, result } = await get(download('bes-clean'))

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toBe('pdf-bytes')
  })

  test('reads the S3 object from the live summary, never from the request', async () => {
    await get(download('bes-clean'))

    expect(s3Client.send).toHaveBeenCalledTimes(1)
    const command = s3Client.send.mock.calls[0][0]
    expect(command.input).toEqual({
      Bucket: 'live-bucket',
      Key: 'keys/bes-clean.pdf'
    })
  })

  test('does a fresh summary read for the work item on every download', async () => {
    await get(download('sp-clean'))
    await get(download('sp-clean'))

    expect(getAccreditationSummary).toHaveBeenCalledTimes(2)
    expect(getAccreditationSummary).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID })
    )
  })

  test('answers 404 for a file that is not in the live summary, without touching S3', async () => {
    const { statusCode } = await get(download('not-in-the-summary'))

    expect(statusCode).toBe(statusCodes.notFound)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('answers 404 for a file that has left the live summary since the page was drawn', async () => {
    getAccreditationSummary.mockResolvedValue(
      aSummary({ samplingPlan: { files: [] } })
    )

    const { statusCode } = await get(download('sp-clean'))

    expect(statusCode).toBe(statusCodes.notFound)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('answers 404 for a file on a site the live summary does not list, such as an unselected one', async () => {
    getAccreditationSummary.mockResolvedValue(aSummary({ overseasSites: [] }))

    const { statusCode } = await get(download('bes-clean'))

    expect(statusCode).toBe(statusCodes.notFound)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('answers 404 for a listed file that has no S3 key', async () => {
    getAccreditationSummary.mockResolvedValue(
      aSummary({ samplingPlan: { files: [aFile('sp-clean', { s3Key: '' })] } })
    )

    const { statusCode } = await get(download('sp-clean'))

    expect(statusCode).toBe(statusCodes.notFound)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test.each([
    ['Pending', 'Pending'],
    ['Infected', 'Infected'],
    ['missing', undefined]
  ])(
    'answers 422 for a file whose scan status is %s, without touching S3',
    async (_, scanStatus) => {
      getAccreditationSummary.mockResolvedValue(
        aSummary({
          samplingPlan: { files: [aFile('sp-unclean', { scanStatus })] }
        })
      )

      const { statusCode, result } = await get(download('sp-unclean'))

      expect(statusCode).toBe(422)
      expect(result).toBe(
        'File is not available for download: scan status is not clean.'
      )
      expect(s3Client.send).not.toHaveBeenCalled()
    }
  )

  test('does not serve a file when S3 fails', async () => {
    s3Client.send.mockRejectedValue(new Error('S3 down'))

    const { statusCode, result } = await get(download('sp-clean'))

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toBe('File not found')
  })

  test.each([
    ['not found, or not Approved', { ok: false, status: 404 }, 404],
    ['a transient failure', { ok: false, status: 503, error: 'down' }, 503],
    ['a transport failure', { ok: false, error: 'ECONNREFUSED' }, 503],
    ['an unusable response', { ok: true }, 503]
  ])(
    'does not serve a file when the live read is %s',
    async (_, outcome, expectedStatus) => {
      getAccreditationSummary.mockResolvedValue(outcome)

      const { statusCode } = await get(download('sp-clean'))

      expect(statusCode).toBe(expectedStatus)
      expect(s3Client.send).not.toHaveBeenCalled()
    }
  )

  test('answers 404 for an unknown work item, without reading the summary', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode } = await get(download('sp-clean'))

    expect(statusCode).toBe(statusCodes.notFound)
    expect(getAccreditationSummary).not.toHaveBeenCalled()
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('answers 502, not 404, when the work item lookup fails', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 500, error: 'boom' })

    const { statusCode } = await get(download('sp-clean'))

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(getAccreditationSummary).not.toHaveBeenCalled()
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('answers 502 when the work item lookup fails without a status', async () => {
    getWorkItem.mockResolvedValue({ ok: false, error: 'timed out' })

    const { statusCode } = await get(download('sp-clean'))

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('answers 404 for a re-accreditation, whose case has no such tab', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: RE_ACCREDITATION_ID,
        typeId: 're-accreditation',
        stateId: 'submitted'
      }
    })

    const { statusCode } = await get(download('sp-clean', RE_ACCREDITATION_ID))

    expect(statusCode).toBe(statusCodes.notFound)
    expect(getAccreditationSummary).not.toHaveBeenCalled()
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  test('leaves the payload-based download route as it was: it still serves from the work item payload', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: ID,
        typeId: 'add-overseas-site',
        stateId: 'submitted',
        payload: { samplingPlan: { files: [aFile('payload-file')] } }
      }
    })

    const { statusCode, result } = await get(
      `/work-items/${ID}/files/payload-file/download`
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toBe('pdf-bytes')
    expect(getAccreditationSummary).not.toHaveBeenCalled()
  })
})
