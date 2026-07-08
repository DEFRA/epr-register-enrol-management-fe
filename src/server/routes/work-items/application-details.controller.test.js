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

  // RA-245. Legacy/seeded items carry a flat string siteAddress plus a flat
  // siteAddressPostcode. Both render verbatim.
  it('renders a legacy flat-string site address and flat postcode', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    getReAccreditationPriorYear.mockResolvedValue({ ok: false, status: 404 })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    const { context } = h._viewCalls[0]
    const rows = context.applicationSection.rows
    const addressRow = rows.find((r) => r.key.text === 'Site address')
    const postcodeRow = rows.find((r) => r.key.text === 'Site postcode')
    expect(addressRow.value.text).toBe('1 Main St, Leeds, LS1 1AB')
    expect(postcodeRow.value.text).toBe('LS1 1AB')
  })

  // RA-245. Form-created items store a nested object with NO flat
  // siteAddressPostcode; the address is joined (postcode excluded) and the
  // postcode comes from the nested field.
  it('renders a nested-object site address and the nested postcode', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          organisationName: 'Acme Ltd',
          siteAddress: {
            line1: '1 Details Lane',
            line2: '',
            town: 'Leeds',
            postcode: 'LS1 1AB'
          }
        }
      })
    })
    getReAccreditationPriorYear.mockResolvedValue({ ok: false, status: 404 })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    const { context } = h._viewCalls[0]
    const rows = context.applicationSection.rows
    const addressRow = rows.find((r) => r.key.text === 'Site address')
    const postcodeRow = rows.find((r) => r.key.text === 'Site postcode')
    expect(addressRow.value.text).toBe('1 Details Lane, Leeds')
    expect(postcodeRow.value.text).toBe('LS1 1AB')
  })

  // RA-245. When there is genuinely no address data, both rows fall back to
  // the em-dash rather than "[object Object]".
  it('falls back to an em-dash when site address data is absent', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: { applicationReference: 'RA-000000001' }
      })
    })
    getReAccreditationPriorYear.mockResolvedValue({ ok: false, status: 404 })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    const { context } = h._viewCalls[0]
    const rows = context.applicationSection.rows
    expect(rows.find((r) => r.key.text === 'Site address').value.text).toBe('—')
    expect(rows.find((r) => r.key.text === 'Site postcode').value.text).toBe(
      '—'
    )
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
