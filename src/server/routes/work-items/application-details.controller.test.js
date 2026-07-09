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
      material: 'paper',
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

/**
 * Consumer contract test: this payload is a literal copy of the JSON built
 * by HttpCaseWorkingApiAdapter.BuildPayload in epr-register-enrol-backend
 * (the real operator submission), not a hand-picked subset. If that
 * adapter's field names ever drift from what this page reads, this test
 * fails instead of the mismatch only showing up as a blank field in the
 * CDP test environment (as happened with `material` vs `materialsHandled`).
 * Keep this fixture in sync with the adapter's BuildPayload.
 */
function realOperatorSubmissionPayload() {
  return {
    organisationName: 'Acme Recycling Ltd',
    registrationNumber: 'EPR-100023',
    material: 'plastic',
    accreditationYear: 2026,
    previousAccreditationYear: 2025,
    complianceIssuesReported: 0,
    siteAddress: '123 High Street, London, SW1A 1AA',
    siteAddressPostcode: 'SW1A 1AA',
    operatorApplicationId: 'app-001',
    operatorOrganisationId: '12345',
    operatorRegistrationId: 'reg-001',
    operatorEmail: 'jane@example.com',
    submittedBy: {
      fullName: 'Jane Smith',
      jobTitle: 'Operations Manager',
      email: 'jane@example.com'
    },
    prns: {
      plannedTonnageBand: 'UpTo1000',
      authorisers: [{ fullName: 'Bob Jones', email: 'bob@example.com' }]
    },
    businessPlan: {
      newInfrastructurePercent: 20,
      priceSupportPercent: 20,
      businessCollectionsPercent: 20,
      communicationsPercent: 20,
      newMarketsPercent: 10,
      newUsesPercent: 10,
      newInfrastructureDetail: 'New sorting line',
      priceSupportDetail: 'Subsidised collection',
      businessCollectionsDetail: 'Kerbside expansion',
      communicationsDetail: 'Customer newsletter',
      newMarketsDetail: 'Export contracts',
      newUsesDetail: 'Recycled packaging'
    },
    samplingPlan: {
      files: [
        {
          filename: 'sampling-plan.pdf',
          uploadedAt: '2026-01-05T10:00:00Z',
          scanStatus: 'Clean'
        }
      ]
    }
  }
}

function rowValue(rows, keyText) {
  return rows.find((row) => row.key.text === keyText)?.value?.text
}

describe('workItemApplicationDetailsController — real operator submission contract', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders every field from a real operator-backend submission payload', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ payload: realOperatorSubmissionPayload() })
    })
    getReAccreditationPriorYear.mockResolvedValue({ ok: false, status: 404 })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    const { context } = h._viewCalls[0]

    expect(rowValue(context.applicationSection.rows, 'Organisation name')).toBe(
      'Acme Recycling Ltd'
    )
    expect(
      rowValue(context.applicationSection.rows, 'Registration number')
    ).toBe('EPR-100023')
    expect(rowValue(context.applicationSection.rows, 'Material')).toBe(
      'plastic'
    )
    expect(
      rowValue(context.applicationSection.rows, 'Accreditation year')
    ).toBe('2026')
    expect(
      rowValue(context.applicationSection.rows, 'Previous accreditation year')
    ).toBe('2025')
    expect(
      rowValue(context.applicationSection.rows, 'Compliance issues reported')
    ).toBe('0')
    expect(rowValue(context.applicationSection.rows, 'Site address')).toBe(
      '123 High Street, London, SW1A 1AA'
    )
    expect(rowValue(context.applicationSection.rows, 'Site postcode')).toBe(
      'SW1A 1AA'
    )

    expect(
      rowValue(context.operatorSection.rows, 'Operator application ID')
    ).toBe('app-001')
    expect(
      rowValue(context.operatorSection.rows, 'Operator organisation ID')
    ).toBe('12345')
    expect(
      rowValue(context.operatorSection.rows, 'Operator registration ID')
    ).toBe('reg-001')
    expect(rowValue(context.operatorSection.rows, 'Operator email')).toBe(
      'jane@example.com'
    )

    expect(context.submittedBySection).not.toBeNull()
    expect(rowValue(context.submittedBySection.rows, 'Full name')).toBe(
      'Jane Smith'
    )
    expect(rowValue(context.submittedBySection.rows, 'Job title')).toBe(
      'Operations Manager'
    )
    expect(rowValue(context.submittedBySection.rows, 'Email')).toBe(
      'jane@example.com'
    )

    expect(context.prnsSection.tonnageBand).toBe('Up to 1,000 tonnes')
    expect(context.prnsSection.authorisers).toEqual([
      { fullName: 'Bob Jones', email: 'bob@example.com' }
    ])

    expect(context.businessPlanRows.length).toBeGreaterThan(0)
    expect(
      context.businessPlanRows.some(
        (row) =>
          row.key.text === 'New infrastructure (detail)' &&
          row.value.text === 'New sorting line'
      )
    ).toBe(true)

    expect(context.samplingPlanFiles).toHaveLength(1)
    expect(context.samplingPlanFiles[0].filename).toBe('sampling-plan.pdf')
    expect(context.samplingPlanFiles[0].scanStatus).toBe('Clean')
  })
})
