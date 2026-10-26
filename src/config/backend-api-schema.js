// Backend API connection settings, kept apart from config.js so that file
// stays under the size limit. Used as the `backendApi` section of the schema.
export const backendApiSchema = {
  url: {
    doc: 'Base URL of the case management backend API',
    format: String,
    default: 'http://localhost:8085',
    env: 'BACKEND_API_URL'
  },
  timeoutMs: {
    doc: 'Timeout for backend API calls in milliseconds',
    format: Number,
    default: 5000,
    env: 'BACKEND_API_TIMEOUT_MS'
  },
  decisionTimeoutMs: {
    doc: 'Per-call timeout in milliseconds for the re-accreditation decision call (POST /work-items/re-accreditation/{id}/decision). This endpoint is deliberately slow: management-be gates the atomic decision on a Registration & Accreditation service push it retries up to 5 times before giving up, and only on Registration & Accreditation service success does it commit any state change (RA-410). Its worst-case budget is ~28s (6 attempts x 3s + 5 x 2s backoff) plus a sub-second local tail. This timeout MUST comfortably exceed that budget: if fe aborts the request before be finishes its retries, be receives a client cancellation instead of returning its clean HTTP 500, which would re-open the original stranding bug. Default 60000ms per be worst-case + margin; separate from backendApi.timeoutMs so raising it does not slow down every other backend call.',
    format: Number,
    default: 60000,
    env: 'BACKEND_API_DECISION_TIMEOUT_MS'
  },
  queryTimeoutMs: {
    doc: 'Per-call timeout in milliseconds for raising a query (POST /work-items/re-accreditation/{id}/query). Unlike a plain read or write, this call does more than one thing before it responds: management-be self-assigns the item, applies the query transition, then runs its post-action work, which includes a GOV.UK Notify email (each attempt can take several seconds, and is retried) and the push that tells the operator backend the application is now queried. Aborting here while that is still running used to cancel the push and leave the operator showing the old status; management-be now finishes it regardless, but a timeout this short still reports the query to the caseworker as failed when it succeeded. Default 30000ms; separate from backendApi.timeoutMs so raising it does not slow down every other backend call.',
    format: Number,
    default: 30000,
    env: 'BACKEND_API_QUERY_TIMEOUT_MS'
  },
  clientId: {
    doc: 'CDP client id sent on outbound calls to the backend (x-cdp-client-id header). Empty string disables the header.',
    format: String,
    default: 'frontend',
    env: 'BACKEND_API_CLIENT_ID'
  },
  sharedSecret: {
    doc: 'HMAC-SHA256 secret for signing outbound requests to the case management backend (BACKEND_API_SHARED_SECRET). Empty string disables signing (local dev). Must match the secret the backend verifies this caller against (AUTH_SHARED_SECRET__MANAGEMENT_FE in epr-register-enrol-management-be) — RA-345 moved that backend from one secret shared with epr-register-enrol-backend to a secret per caller, so this value must be distinct from whatever epr-register-enrol-backend signs with.',
    format: String,
    default: '',
    env: 'BACKEND_API_SHARED_SECRET',
    sensitive: true
  }
}
