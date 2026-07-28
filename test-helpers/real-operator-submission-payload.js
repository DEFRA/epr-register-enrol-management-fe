/**
 * Consumer contract fixture: a literal copy of the JSON built by
 * `HttpCaseWorkingApiAdapter.BuildPayload` in epr-register-enrol-backend
 * (the real operator submission), NOT a hand-picked subset.
 *
 * If that adapter's field names ever drift from what the case management
 * pages read, the tests using this fixture fail — instead of the mismatch
 * only showing up as a blank field in the CDP test environment, which is
 * exactly what happened with `material` vs `materialsHandled`.
 *
 * **Keep this fixture in sync with the adapter's `BuildPayload`.** Add a
 * field here the moment the adapter starts emitting it, and never "fix" a
 * failing contract assertion by editing the fixture to match the frontend —
 * the whole point is that the fixture tracks the producer, not the consumer.
 *
 * RA-295 moved this out of the deleted application-details controller test
 * and into a shared helper, because the work item detail page now reads
 * MORE of this payload than the page it originally guarded.
 */
export function realOperatorSubmissionPayload() {
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
