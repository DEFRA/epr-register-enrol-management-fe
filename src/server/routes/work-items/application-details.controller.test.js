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
    // Navigational label matches the reference when present.
    expect(context.workItemLabel).toBe('RA-000000001')
    // The DATA row labelled "Application reference" shows the reference.
    expect(context.applicationSection.rows[0].key.text).toBe(
      'Application reference'
    )
    expect(context.applicationSection.rows[0].value.text).toBe('RA-000000001')
    expect(context.applicationSection.rows[1].value.text).toBe('Acme Ltd')
  })

  // RA-249: a field LABELLED "Application reference" must show the human
  // RA-* reference or NOTHING — never the work-item Guid. When the reference
  // is absent the displayed value is null (not the id), while the
  // navigational label still falls back to the id.
  it('shows a null application reference (never the id) when applicationReference is missing, keeping the id as the navigational label', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: { organisationName: 'Acme Ltd' } // No applicationReference
      })
    })
    getReAccreditationPriorYear.mockResolvedValue({ ok: false, status: 404 })
    const h = makeH()
    await workItemApplicationDetailsController.handler(makeRequest(), h)

    const { context } = h._viewCalls[0]
    // Displayed application ref is null and specifically NOT the work-item id.
    expect(context.applicationRef).toBeNull()
    expect(context.applicationRef).not.toBe(WORK_ITEM_ID)
    const appRefRow = context.applicationSection.rows[0]
    expect(appRefRow.key.text).toBe('Application reference')
    expect(appRefRow.value.text).toBeNull()
    expect(appRefRow.value.text).not.toBe(WORK_ITEM_ID)
    // Navigational label falls back to the work-item id.
    expect(context.workItemLabel).toBe(WORK_ITEM_ID)
    // Page title and breadcrumb leaf use the navigational label (the id).
    expect(context.pageTitle).toBe(`Application details — ${WORK_ITEM_ID}`)
    const leaf = context.breadcrumbs.find(
      (b) => b.href === `/work-items/${WORK_ITEM_ID}`
    )
    expect(leaf.text).toBe(WORK_ITEM_ID)
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
