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
    // The adapter emits `materialsHandled` (an array) alongside the singular
    // `material`. Nothing reads it today, but it is on the wire — and the
    // `material` / `materialsHandled` confusion is the exact drift that
    // shipped a blank field to CDP and prompted this fixture.
    materialsHandled: ['plastic'],
    glassRecyclingProcess: null,
    material: 'plastic',
    // RA-314. The reprocessor/exporter discriminator, written into every
    // submitted work-item payload. This fixture is a reprocessor submission.
    wasteProcessingType: 'reprocessor',
    accreditationYear: 2026,
    previousAccreditationYear: 2025,
    complianceIssuesReported: 0,
    // RA-434. Companies house number + the full registered address, and the
    // permit numbers extracted from `WasteManagementPermitDto` — three wire
    // keys the adapter did not emit before RA-434.
    companiesHouseNumber: '01234567',
    companyRegisteredAddress: '1 Example Street, London, EC1A 1BB',
    permitNumbers: ['WML123456', 'PPC456789'],
    siteAddress: '123 High Street, London, SW1A 1AA',
    siteAddressPostcode: 'SW1A 1AA',
    operatorApplicationId: 'app-001',
    operatorOrganisationId: '12345',
    // RA-503. The operator/regulator-safe numeric organisation number, added alongside the
    // existing (internal-only) operatorOrganisationId - see HttpCaseWorkingApiAdapter.BuildPayload.
    operatorOrgNumber: 500500,
    operatorRegistrationId: 'reg-001',
    operatorEmail: 'jane@example.com',
    submittedBy: {
      fullName: 'Jane Smith',
      jobTitle: 'Operations Manager',
      email: 'jane@example.com'
    },
    // RA-480. The original registration submitter's contact details, as
    // captured by ReEx at registration time — distinct from `submittedBy`
    // above (captured at Case Management service submit time, a different
    // person).
    submitterContactDetails: {
      fullName: 'Barton Deckow',
      email: 'REEXServiceTeam@defra.gov.uk',
      phone: '0111 478 4919',
      jobTitle: 'Human Infrastructure Architect'
    },
    prns: {
      plannedTonnageBand: 'UpTo5000',
      authorisers: [{ fullName: 'Bob Jones', email: 'bob@example.com' }]
    },
    businessPlan: {
      // RA-456 added a 7th "Other" category — percentages rebalanced across
      // all seven fields so the set still sums to 100.
      newInfrastructurePercent: 15,
      priceSupportPercent: 15,
      businessCollectionsPercent: 15,
      communicationsPercent: 15,
      newMarketsPercent: 10,
      newUsesPercent: 10,
      otherPercent: 20,
      newInfrastructureDetail: 'New sorting line',
      priceSupportDetail: 'Subsidised collection',
      businessCollectionsDetail: 'Kerbside expansion',
      communicationsDetail: 'Customer newsletter',
      newMarketsDetail: 'Export contracts',
      newUsesDetail: 'Recycled packaging',
      otherDetail: 'Community recycling outreach'
    },
    samplingPlan: {
      files: [
        {
          // `fileId` is `required` on AccreditationApplicationFile, so it is
          // always on the wire — and it is what `fileViewModel` builds the
          // download href from. Omitting it made every Clean file in this
          // fixture resolve `href: null`, so a rename of `fileId` on the
          // producer could not fail this test: exactly the drift class the
          // fixture exists to catch.
          fileId: 'file-sampling-001',
          filename: 'sampling-plan.pdf',
          contentType: 'application/pdf',
          uploadedAt: '2026-01-05T10:00:00Z',
          scanStatus: 'Clean',
          s3Key: 'sampling-plans/full-payload/sampling-plan.pdf',
          s3Bucket: 'epr-register-enrol-sampling-plans'
        }
      ]
    },
    // Emitted unconditionally by BuildPayload, degrading to `{ sites: [] }`
    // for a reprocessor. Present-and-empty is still worth pinning even though
    // BES/ORS gating now reads `wasteProcessingType` (RA-434-processortype),
    // not this list's emptiness — a fixture that omitted the key entirely
    // would silently stop proving the adapter still sends it.
    overseasSites: { sites: [] }
  }
}
