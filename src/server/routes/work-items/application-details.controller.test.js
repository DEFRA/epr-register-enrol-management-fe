import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getWorkItem: vi.fn(),
  getReAccreditationPriorYear: vi.fn()
}))

const { getWorkItem, getReAccreditationPriorYear } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const { workItemApplicationDetailsController } =
  await import('./application-details.controller.js')

const WORK_ITEM_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeRequest(overrides = {}) {
  return {
    params: { id: WORK_ITEM_ID },
    auth: { credentials: { id: 'user-1', name: 'Alice', roles: [] } },
    ...overrides
  }
}

function makeH() {
  const viewCalls = []
  const redirectCalls = []
  return {
    view: vi.fn((template, context) => {
      viewCalls.push({ template, context })
      return { template, context }
    }),
    redirect: vi.fn((url) => {
      redirectCalls.push(url)
      return { redirect: url }
    }),
    _viewCalls: viewCalls,
    _redirectCalls: redirectCalls
  }
}

function aWorkItem(overrides = {}) {
  return {
    id: WORK_ITEM_ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    payload: {
      applicationReference: 'RA-000000001',
      organisationName: 'Acme Ltd',
      registrationNumber: 'WEX001',
      accreditationYear: 2025,
      materialsHandled: ['paper'],
      siteAddress: '1 Main St, Leeds, LS1 1AB',
      siteAddressPostcode: 'LS1 1AB'
    },
    ...overrides
  }
}

describe('workItemApplicationDetailsController', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('redirects to work item when getWorkItem fails', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)
    expect(h.redirect).toHaveBeenCalledWith(`/work-items/${WORK_ITEM_ID}`)
  })

  it('renders the view with application section when getWorkItem succeeds', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    getReAccreditationPriorYear.mockResolvedValue({ ok: false, status: 404 })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    expect(h.view).toHaveBeenCalledOnce()
    const { context } = h._viewCalls[0]
    expect(context.applicationRef).toBe('RA-000000001')
    expect(context.applicationSection.rows[1].value.text).toBe('Acme Ltd')
  })

  it('calls getReAccreditationPriorYear for re-accreditation work items', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    getReAccreditationPriorYear.mockResolvedValue({ ok: false, status: 404 })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)
    expect(getReAccreditationPriorYear).toHaveBeenCalledWith({
      workItemId: WORK_ITEM_ID,
      user: expect.any(Object)
    })
  })

  it('does not call getReAccreditationPriorYear for other work item types', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ typeId: 'some-other-type' })
    })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)
    expect(getReAccreditationPriorYear).not.toHaveBeenCalled()
  })

  it('passes priorYearSection to view when prior year data is available', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    getReAccreditationPriorYear.mockResolvedValue({
      ok: true,
      priorYear: {
        year: 2024,
        tonnageBand: 'UpTo1000',
        authorisers: [{ fullName: 'Jane Smith', email: 'jane@example.com' }],
        businessPlan: {
          newInfrastructurePercent: 20,
          priceSupportPercent: 20,
          businessCollectionsPercent: 20,
          communicationsPercent: 20,
          newMarketsPercent: 10,
          newUsesPercent: 10
        }
      }
    })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    const { context } = h._viewCalls[0]
    expect(context.priorYearSection).not.toBeNull()
    expect(context.priorYearSection.year).toBe(2024)
    expect(context.priorYearSection.tonnageBand).toBe('Up to 1,000 tonnes')
    expect(context.priorYearSection.authorisers).toHaveLength(1)
    expect(context.priorYearSection.authorisers[0].fullName).toBe('Jane Smith')
    expect(context.priorYearSection.businessPlanRows.length).toBeGreaterThan(0)
  })

  it('sets priorYearSection to null when prior year API returns 404', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    getReAccreditationPriorYear.mockResolvedValue({ ok: false, status: 404 })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    const { context } = h._viewCalls[0]
    expect(context.priorYearSection).toBeNull()
  })

  it('sets priorYearSection to null when prior year API errors', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    getReAccreditationPriorYear.mockResolvedValue({
      ok: false,
      error: 'Request timed out'
    })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    const { context } = h._viewCalls[0]
    expect(context.priorYearSection).toBeNull()
  })

  it('sets priorYearSection to null for non-re-accreditation types', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ typeId: 'some-other-type' })
    })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    const { context } = h._viewCalls[0]
    expect(context.priorYearSection).toBeNull()
  })
})
