import { vi } from 'vitest'
import { createServer } from '#/server/server.js'
import {
  getWorkItem,
  getWorkItems,
  performAddOverseasSiteOperation
} from '#/server/common/helpers/backend-api/backend-api.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

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

  test.each([
    ['submitted', {}, 'add-ors-start-assessment'],
    ['assessment-in-progress', {}, 'add-ors-refuse'],
    ['assessment-in-progress', {}, 'add-ors-approve'],
    ['rejected', {}, 'add-ors-retry-outcome'],
    ['approved', {}, 'add-ors-retry-outcome']
  ])(
    'state %s offers its supported module operation',
    async (stateId, payload, testId) => {
      vi.mocked(getWorkItem).mockResolvedValue({
        ok: true,
        workItem: { ...item, stateId, payload: { ...item.payload, ...payload } }
      })
      const response = await server.inject(`/work-items/${item.id}`)
      expect(response.statusCode).toBe(200)
      expect(response.result).toContain(`data-testid="${testId}"`)
      if (stateId !== 'assessment-in-progress') {
        expect(response.result).not.toContain('data-testid="add-ors-approve"')
      }
    }
  )

  test.each(['rejected', 'approved'])(
    'confirmed %s delivery offers no further mutation',
    async (stateId) => {
      vi.mocked(getWorkItem).mockResolvedValue({
        ok: true,
        workItem: {
          ...item,
          stateId,
          payload: { ...item.payload, outcomeDeliveryConfirmed: true }
        }
      })
      const response = await server.inject(`/work-items/${item.id}`)
      expect(response.result).toContain('Operator outcome confirmed')
      expect(response.result).not.toContain(
        'data-testid="add-ors-retry-outcome"'
      )
    }
  )

  test.each(['start-assessment', 'refuse', 'approve'])(
    'protected %s posts through the module and redirects to current case details',
    async (operation) => {
      vi.mocked(performAddOverseasSiteOperation).mockResolvedValue({
        ok: true,
        workItem: item
      })
      const response = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/add-overseas-site/${item.id}/${operation}`,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }
      })
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(`/work-items/${item.id}`)
      expect(performAddOverseasSiteOperation).toHaveBeenCalledWith({
        workItemId: item.id,
        operation,
        user: expect.objectContaining({ id: expect.any(String) })
      })
    }
  )

  test.each([
    ['refuse', 'rejected', 409],
    ['refuse', 'rejected', 503],
    ['approve', 'approved', 409],
    ['approve', 'approved', 503]
  ])(
    'failed %s (%s, %s) remains visible on the returned case with a retry of the same decision',
    async (operation, stateId, status) => {
      vi.mocked(performAddOverseasSiteOperation).mockResolvedValue({
        ok: false,
        status
      })
      const response = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/add-overseas-site/${item.id}/${operation}`,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }
      })
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(`/work-items/${item.id}`)
      vi.mocked(getWorkItem).mockResolvedValue({
        ok: true,
        workItem: { ...item, stateId }
      })
      const cookie = []
        .concat(response.headers['set-cookie'] || [])
        .map((entry) => entry.split(';')[0])
        .join('; ')
      const returned = await server.inject({
        url: response.headers.location,
        headers: { cookie }
      })
      expect(returned.result).toContain(
        status === 503
          ? 'Operator delivery unconfirmed'
          : 'Operation unconfirmed'
      )
      expect(returned.result).toContain('data-testid="add-ors-retry-outcome"')
      expect(returned.result).toContain(
        `action="/work-items/add-overseas-site/${item.id}/${operation}"`
      )
      expect(returned.result).not.toContain(
        'data-testid="add-ors-delivery-confirmed"'
      )
    }
  )

  test('support can read but cannot assess, approve, refuse or retry; missing CSRF is rejected', async () => {
    vi.mocked(getWorkItem).mockResolvedValue({
      ok: true,
      workItem: { ...item, stateId: 'assessment-in-progress' }
    })
    const read = await server.inject({
      url: `/work-items/${item.id}`,
      headers: { 'x-test-user-role': 'support-readonly' }
    })
    expect(read.statusCode).toBe(200)
    expect(read.result).not.toContain('data-testid="add-ors-refuse"')
    expect(read.result).not.toContain('data-testid="add-ors-approve"')
    for (const operation of ['start-assessment', 'refuse', 'approve']) {
      const forbidden = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/add-overseas-site/${item.id}/${operation}`,
        payload: '',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-test-user-role': 'support-readonly'
        }
      })
      expect(forbidden.statusCode).toBe(403)
      const missingCrumb = await server.inject({
        method: 'POST',
        url: `/work-items/add-overseas-site/${item.id}/${operation}`,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }
      })
      expect(missingCrumb.statusCode).toBe(403)
    }
  })
})
