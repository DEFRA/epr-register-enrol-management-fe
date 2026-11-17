/**
 * RA-495. Re-accreditation's management-be calls for the shared
 * Standard-lifecycle pages: its own type-scoped endpoints
 * (`/work-items/re-accreditation/{id}/duly-make|decision|confirm-contact`),
 * which refuse any other type. Loaded lazily so tests can stub the client
 * without mocking `undici`.
 */

async function backendApi() {
  return import('#/server/common/helpers/backend-api/backend-api.js')
}

export const reAccreditationLifecycleBackend = Object.freeze({
  dulyMake: async (args) => (await backendApi()).dulyMakeReAccreditation(args),
  recordDecision: async (args) =>
    (await backendApi()).recordReAccreditationDecision(args),
  confirmContact: async (args) =>
    (await backendApi()).confirmApplicantContact(args)
})
