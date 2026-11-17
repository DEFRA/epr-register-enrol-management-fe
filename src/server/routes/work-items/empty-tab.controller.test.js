/**
 * RA-495. The empty case tab pages (Accreditation summary, Related
 * applications). Their add-ORS rendering and not-found cases are in
 * `in-year-change.route.test.js`; this covers the page title and a backend
 * failure.
 */
import { vi } from 'vitest'
import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

vi.mock(
  '#/server/common/helpers/backend-api/backend-api.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    getWorkItem: vi.fn()
  })
)

const { getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '49500003-0000-4000-8000-000000000001'

function anAddOrsItem() {
  return {
    id: ID,
    typeId: 'add-overseas-site',
    stateId: 'submitted',
    templateVersion: 'v1',
    submittedAt: '2027-02-11T10:00:00Z',
    payload: {
      applicationReference: 'IYC-ORS-2027-00001',
      site: { orsId: '007', siteName: 'Denmark PR' }
    }
  }
}

describe('RA-495: empty case tab pages', () => {
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
  })

  test.each([
    ['accreditation-summary', 'Accreditation summary'],
    ['related-applications', 'Related applications']
  ])('/%s is titled with the tab and the reference', async (path, title) => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/${path}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(cheerio.load(result)('title').text()).toContain(
      `${title} — IYC-ORS-2027-00001`
    )
    expect(getWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID })
    )
  })

  test('shows the work item unavailable page when the backend fails', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 500, error: 'boom' })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/accreditation-summary`
    })

    expect(statusCode).toBe(502)
    expect(result).toContain('Work item unavailable')
  })
})
