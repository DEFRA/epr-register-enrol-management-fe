import { vi } from 'vitest'
import { createServer } from '#/server/server.js'
import {
  getWorkItem,
  getWorkItems
} from '#/server/common/helpers/backend-api/backend-api.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js')

const item = {
  id: '11111111-1111-1111-1111-111111111111',
  typeId: 'add-overseas-site',
  stateId: 'submitted',
  templateVersion: 'v1',
  submittedAt: '2026-10-14T10:00:00Z',
  payload: {
    operatorRequestId: 'request-1',
    proposedSiteId: 'site-1',
    applicationReference: 'AP26EXAMPLE',
    organisationName: 'Global Glass Exports',
    target: {
      organisationId: '50006',
      registrationId: 'registration-1',
      accreditationId: 'granted-1',
      materialType: 'Glass',
      year: 2026
    },
    proposal: {
      siteName: 'Spike Glass Recycling',
      siteAddress: '25 Example Road, Hamburg',
      country: 'Germany'
    }
  },
  availableActions: []
}

describe('Add ORS public pages', () => {
  let server
  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })
  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('stored v1 case renders its exact target, proposal, request and case correlation without later operations', async () => {
    vi.mocked(getWorkItem).mockResolvedValue({ ok: true, workItem: item })
    const response = await server.inject(`/work-items/${item.id}`)
    expect(response.statusCode).toBe(200)
    expect(response.result).toContain('data-testid="add-ors-detail"')
    for (const text of [
      'Add ORS',
      'request-1',
      'site-1',
      'granted-1',
      'registration-1',
      '50006',
      'Glass',
      '2026',
      'Spike Glass Recycling',
      'AP26EXAMPLE',
      'Submitted'
    ]) {
      expect(response.result).toContain(text)
    }
    expect(response.result).not.toContain(
      'data-testid="work-item-log-decision"'
    )
    expect(response.result).not.toContain('data-testid="work-item-duly-make"')
  })

  test('Application type Add ORS passes the real type constraint and labels the case correctly', async () => {
    vi.mocked(getWorkItems).mockResolvedValue({
      ok: true,
      items: [item],
      totalCount: 1,
      page: 1,
      pageSize: 20
    })
    const response = await server.inject(
      '/work-items?applicationType=add-overseas-site&assigneeMode=any&filtersApplied=1'
    )
    expect(response.statusCode).toBe(200)
    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ typeIds: ['add-overseas-site'] })
    )
    expect(response.result).toContain('value="add-overseas-site"')
    expect(response.result).toContain('data-testid="application-type">Add ORS')
  })
})
