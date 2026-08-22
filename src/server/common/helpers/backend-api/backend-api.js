import { fetch } from 'undici'

import { config } from '#/config/config.js'
import { createLogger } from '../logging/logger.js'
import { signRequestHeaders } from './sign-request.js'
import {
  NATION_ROLE_MAP,
  ROLE_STANDARD,
  ROLE_SUPPORT_READONLY
} from '../auth/auth-scopes.js'

const logger = createLogger()

const CLIENT_ID_HEADER = 'x-cdp-client-id'
const USER_ID_HEADER = 'x-cdp-user-id'
const USER_NAME_HEADER = 'x-cdp-user-name'
const USER_ROLE_HEADER = 'x-cdp-user-role'
const USER_NATION_HEADER = 'x-cdp-user-nation'

/**
 * Defence-in-depth guard against HTTP header injection (CRLF). User-supplied
 * data (id, name) flows from the session into outbound headers via
 * {@link buildHeaders}; undici will normally reject CR/LF in header values
 * but we must not rely on that as our only defence. Throws fast on any
 * non-string or any string containing CR or LF so the request fails before
 * reaching the network — the surrounding try/catch maps the failure to a
 * `{ ok: false, error }` result which controllers turn into a 500.
 *
 * @param {unknown} value
 */
export function assertSafeHeaderValue(value) {
  if (typeof value !== 'string') {
    throw new TypeError(
      `Outbound header value must be a string, got ${typeof value}`
    )
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(
      'Outbound header value contains CR or LF (possible header injection)'
    )
  }
}

/**
 * Build the headers attached to every backend call. The client id
 * identifies the BFF *as a service* and is required — proven via the HMAC
 * signature below, not by CDP itself; the optional user-* headers forward
 * the acting end-user's identity for audit attribution. Authorization is not
 * one of the backend's concerns — it trusts any caller that can produce a
 * validly-signed request and defers all access decisions to this BFF, so
 * role membership is not forwarded.
 *
 * Every forwarded value is run through {@link assertSafeHeaderValue} so a
 * malicious session payload cannot smuggle additional headers via CRLF.
 */
function buildHeaders(extra = {}, user = null) {
  const headers = { ...extra }
  const clientId = config.get('backendApi.clientId')
  if (clientId) {
    assertSafeHeaderValue(clientId)
    headers[CLIENT_ID_HEADER] = clientId
  }
  if (user) {
    if (user.id) {
      const id = String(user.id)
      assertSafeHeaderValue(id)
      headers[USER_ID_HEADER] = id
    }
    if (user.name) {
      const name = String(user.name)
      assertSafeHeaderValue(name)
      headers[USER_NAME_HEADER] = name
    }
  }
  return { ...headers, ...signRequestHeaders(headers) }
}

/**
 * RA-469 AC17: unlike every other backend call in this file, management-be's
 * recycling-operations endpoint enforces role/nation authorization
 * server-side (deliberately, per the ticket - "not just in the UI"), so it
 * needs the caller's role/nation forwarded as headers, which the general
 * {@link buildHeaders} contract otherwise deliberately omits. Kept as a
 * narrow, call-site-scoped exception rather than changing buildHeaders'
 * default behaviour for every other endpoint.
 */
// A session holds exactly one of these two roles, never both (see
// auth-scopes.js) - checked in this order so an (unexpected) session
// carrying both is still resolved deterministically rather than by
// object/array iteration order.
function currentRole(roles) {
  if (roles.includes(ROLE_SUPPORT_READONLY)) {
    return ROLE_SUPPORT_READONLY
  }
  if (roles.includes(ROLE_STANDARD)) {
    return ROLE_STANDARD
  }
  return null
}

function recyclingOperationsAuthHeaders(user) {
  const roles = user?.roles ?? []
  const role = currentRole(roles)
  const nationRole = roles.find((r) => r in NATION_ROLE_MAP)
  const nation = nationRole ? NATION_ROLE_MAP[nationRole] : null

  const headers = {}
  if (role) {
    assertSafeHeaderValue(role)
    headers[USER_ROLE_HEADER] = role
  }
  if (nation) {
    assertSafeHeaderValue(nation)
    headers[USER_NATION_HEADER] = nation
  }
  return headers
}

/**
 * Calls the case management backend's /health endpoint.
 *
 * Returns an object describing reachability:
 *  - { ok: true, status, body }     when the backend responds
 *  - { ok: false, error }           when the request fails or times out
 */
export async function getBackendHealth({
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
} = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}/health`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: buildHeaders()
    })
    const body = await response.text()

    return {
      ok: response.ok,
      status: response.status,
      body: body?.trim() || ''
    }
  } catch (error) {
    logger.warn({ err: error, url }, 'Backend API health check failed')
    return {
      ok: false,
      error: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetches a single page of work items from the case management backend.
 *
 * Accepts the filter / search / pagination shape that the backend's
 * `GET /work-items` endpoint expects:
 *  - `typeIds` / `stateIds` — string arrays, repeated as `typeId=` / `stateId=`
 *  - `wasteProcessingTypes` — string array, repeated as `wasteProcessingType=`
 *    (RA-412 — matches `payload.wasteProcessingType`, e.g. Exporter)
 *  - `search`               — free-text needle
 *  - `page` / `pageSize`    — 1-based page + page size
 *
 * Returns an object describing the result:
 *  - { ok: true, items, totalCount, page, pageSize }   on success
 *  - { ok: false, status?, error }                     on transport / 4xx-5xx
 *
 * Items keep the backend's `WorkItemResponse` shape:
 *   { id, typeId, stateId, submittedAt, submittedBy, payload }
 */
export async function getWorkItems({
  typeIds,
  stateIds,
  nations,
  wasteProcessingTypes,
  materials,
  sort,
  organisation,
  search,
  orgId,
  registrationId,
  orgName,
  assigneeId,
  unassigned,
  includeArchived,
  page,
  pageSize,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
} = {}) {
  const url = buildWorkItemsUrl(baseUrl, {
    typeIds,
    stateIds,
    nations,
    wasteProcessingTypes,
    materials,
    sort,
    organisation,
    search,
    orgId,
    registrationId,
    orgName,
    assigneeId,
    unassigned,
    includeArchived,
    page,
    pageSize
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: buildHeaders({ accept: 'application/json' }, user)
    })

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Backend returned ${response.status}`
      }
    }

    const body = await response.json()
    return parseWorkItemsBody(body)
  } catch (error) {
    logger.warn({ err: error, url }, 'Backend API getWorkItems failed')
    return {
      ok: false,
      error: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

function buildWorkItemsUrl(
  baseUrl,
  {
    typeIds,
    stateIds,
    nations,
    wasteProcessingTypes,
    materials,
    sort,
    organisation,
    search,
    orgId,
    registrationId,
    orgName,
    assigneeId,
    unassigned,
    includeArchived,
    page,
    pageSize
  }
) {
  const root = `${baseUrl.replace(/\/$/, '')}/work-items`
  const params = new URLSearchParams()

  for (const typeId of toArray(typeIds)) {
    if (typeId) {
      params.append('typeId', typeId)
    }
  }
  for (const stateId of toArray(stateIds)) {
    if (stateId) {
      params.append('stateId', stateId)
    }
  }
  for (const nation of toArray(nations)) {
    if (nation) {
      params.append('nation', nation)
    }
  }
  // RA-412. Mirrors the nation loop above — repeated values, matched against
  // `payload.wasteProcessingType` by management-be.
  for (const wasteProcessingType of toArray(wasteProcessingTypes)) {
    if (wasteProcessingType) {
      params.append('wasteProcessingType', wasteProcessingType)
    }
  }
  // RA-324 phase-2. Repeated material tokens (?material=plastic&material=glass).
  for (const material of toArray(materials)) {
    if (material) {
      params.append('material', material)
    }
  }
  // RA-324 phase-2. Server-side sort of the full result set.
  if (sort && String(sort).trim() !== '') {
    params.append('sort', String(sort).trim())
  }
  // RA-324 phase-2. Combined "Organisation name or ID" search.
  if (organisation && String(organisation).trim() !== '') {
    params.append('organisation', String(organisation).trim())
  }
  if (search && String(search).trim() !== '') {
    params.append('search', String(search).trim())
  }
  if (orgId && String(orgId).trim() !== '') {
    params.append('orgId', String(orgId).trim())
  }
  if (registrationId && String(registrationId).trim() !== '') {
    params.append('registrationId', String(registrationId).trim())
  }
  if (orgName && String(orgName).trim() !== '') {
    params.append('orgName', String(orgName).trim())
  }
  if (assigneeId && String(assigneeId).trim() !== '') {
    params.append('assigneeId', String(assigneeId).trim())
  }
  if (unassigned === true) {
    params.append('unassigned', 'true')
  }
  if (includeArchived === true) {
    params.append('includeArchived', 'true')
  }
  if (page != null && page !== '') {
    params.append('page', String(page))
  }
  if (pageSize != null && pageSize !== '') {
    params.append('pageSize', String(pageSize))
  }

  const qs = params.toString()
  return qs === '' ? root : `${root}?${qs}`
}

function toArray(value) {
  if (value == null) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function parseWorkItemsBody(body) {
  // Tolerate a bare list (older backend / tests) as well as the paged envelope.
  if (Array.isArray(body)) {
    return {
      ok: true,
      items: body,
      totalCount: body.length,
      page: 1,
      pageSize: body.length
    }
  }
  if (body && Array.isArray(body.items)) {
    return {
      ok: true,
      items: body.items,
      totalCount:
        typeof body.totalCount === 'number'
          ? body.totalCount
          : body.items.length,
      page: typeof body.page === 'number' ? body.page : 1,
      pageSize:
        typeof body.pageSize === 'number' ? body.pageSize : body.items.length
    }
  }
  return { ok: true, items: [], totalCount: 0, page: 1, pageSize: 0 }
}

/**
 * Fetch a single work item by id.
 *
 * Returns the backend's `WorkItemResponse` shape so the caller can render
 * the full envelope (id, type, state, payload, templateVersion) plus engine
 * projection (availableActions). Result shape:
 *  - { ok: true, workItem }                  on success
 *  - { ok: false, status: 404 }              when no work item exists
 *  - { ok: false, status, error }            on other 4xx/5xx
 *  - { ok: false, error }                    on transport errors
 */
export async function getWorkItem({
  workItemId,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: buildHeaders({ accept: 'application/json' }, user)
    })

    if (response.status === 404) {
      return { ok: false, status: 404 }
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Backend returned ${response.status}`
      }
    }

    const workItem = await response.json()
    return { ok: true, workItem }
  } catch (error) {
    logger.warn({ err: error, url }, 'Backend API getWorkItem failed')
    return {
      ok: false,
      error: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Invoke a named action (e.g. "approve", "reject") against a work item.
 * Same response shape as {@link applyWorkItemAction}.
 */
export async function applyWorkItemAction({
  workItemId,
  actionId,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/actions/${encodeURIComponent(actionId)}`
  return postJson({
    url,
    timeoutMs,
    fetchImpl,
    user,
    label: 'applyWorkItemAction'
  })
}

/**
 * Assign (or re-assign) a work item to a user. Authorization (who is
 * allowed to assign what) is this BFF's responsibility, not the backend's
 * — this client just forwards the request and the acting user's identity.
 *
 * Same response shape as {@link applyWorkItemAction}, with the addition
 * that a 403 reaches the caller as `{ ok: false, status: 403, problem }` —
 * the caller's service layer maps that to a `not-authorized` reason.
 */
export async function assignWorkItem({
  workItemId,
  assigneeId,
  assigneeName,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/assign`
  return postJson({
    url,
    timeoutMs,
    fetchImpl,
    user,
    label: 'assignWorkItem',
    body: { assigneeId, assigneeName: assigneeName ?? null }
  })
}

export async function unassignWorkItem({
  workItemId,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/unassign`
  return postJson({
    url,
    timeoutMs,
    fetchImpl,
    user,
    label: 'unassignWorkItem'
  })
}

/**
 * Append a free-text note to a work item (RA-96). The backend snapshots
 * the acting user's id and name (forwarded via the standard user-* headers)
 * onto the note for an immutable audit narrative. Same response shape as
 * {@link applyWorkItemAction} — the updated `WorkItemResponse`, including
 * the freshly-appended note projected newest-first under `notes`.
 *
 * Used by the withdraw and re-accreditation approval flows to capture the
 * caseworker's optional rationale before the state transition; there is no
 * longer a standalone "add a note" feature on the work item detail page.
 */
export async function addWorkItemNote({
  workItemId,
  text,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/notes`
  return postJson({
    url,
    timeoutMs,
    fetchImpl,
    user,
    label: 'addWorkItemNote',
    body: { text }
  })
}

/**
 * Approve a re-accreditation work item via the type-specific endpoint
 * (RA-132).
 *
 * Wraps `POST /work-items/re-accreditation/{id}/approve` on the backend.
 * No request body. The backend enforces actor identity and the
 * `assessment-in-progress` state precondition; decision-maker role
 * membership and tenant scoping are this BFF's responsibility, not the
 * backend's. This client just forwards the call and the acting user's
 * identity via the standard headers.
 *
 * Result shape mirrors {@link createWorkItem}:
 *  - 200 → { ok: true, workItem }
 *  - 400 → { ok: false, reason: 'invalid', status: 400, message }
 *  - 401 → { ok: false, reason: 'unauthorized', status: 401, message }
 *  - 403 → { ok: false, reason: 'forbidden', status: 403, message }
 *  - 404 → { ok: false, reason: 'not-found', status: 404, message }
 *  - 409 → { ok: false, reason: 'conflict', status: 409, message }
 *  - other → { ok: false, reason: 'server', status, message }
 *  - network → { ok: false, reason: 'network', message }
 *
 * RA-448 phase 2: uses `backendApi.approveTimeoutMs`, NOT the shared
 * `backendApi.timeoutMs`. This endpoint now resolves a real accreditation
 * number from a second backend before committing anything, with a firm
 * worst-case budget of ~19s — see the config doc for why fe must not abort
 * before be finishes retrying (same stranding-bug class approveTimeoutMs's
 * sibling decisionTimeoutMs already guards against on /decision).
 */
export async function approveReAccreditation({
  workItemId,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.approveTimeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/re-accreditation/${encodeURIComponent(workItemId)}/approve`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: buildHeaders({ accept: 'application/json' }, user)
    })

    if (response.ok) {
      const workItem = await response.json()
      return { ok: true, workItem }
    }

    const problem = await safeReadJson(response)
    const detail =
      (problem && (problem.detail || problem.title)) ||
      `Backend returned ${response.status}`

    const reason = REASON_BY_STATUS[response.status] ?? 'server'
    return {
      ok: false,
      reason,
      status: response.status,
      message: detail
    }
  } catch (error) {
    logger.warn(
      { err: error, url },
      'Backend API approveReAccreditation failed'
    )
    return {
      ok: false,
      reason: 'network',
      message: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

// Shared by every type-specific POST client below (approve,
// continue-review, ...). Nothing in it is specific to any one of them —
// it is just the HTTP-status-to-reason translation the whole backend
// speaks.
const REASON_BY_STATUS = {
  400: 'invalid',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  409: 'conflict'
}

/**
 * Continue the review of a re-accreditation work item sitting in the
 * `updated` state (RA-372).
 *
 * Wraps `POST /work-items/re-accreditation/{id}/continue-review`. The
 * endpoint takes NO body: which of the four `continue-review-during-*`
 * transitions applies is resolved server-side from the work item's own
 * `resume-during-*` audit history, precisely so a caller cannot choose
 * (and therefore cannot send the item to an attacker-picked stage). The
 * target state is read off the returned envelope, never predicted here.
 *
 * A repeat call for an item that has already left `updated` into a valid
 * continue target is an idempotent replay: the backend answers 200 with
 * the current envelope and an `x-idempotent-replay: true` header. That is
 * deliberately surfaced as plain success — a double-clicked button, or the
 * `submitted` auto-transition to `duly-made` that can fire when the last
 * task is completed while in `updated`, must not look like an error.
 *
 * Result shape mirrors {@link approveReAccreditation}.
 */
export async function continueReviewReAccreditation({
  workItemId,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/re-accreditation/${encodeURIComponent(workItemId)}/continue-review`

  const result = await postJson({
    url,
    timeoutMs,
    fetchImpl,
    user,
    label: 'continueReviewReAccreditation'
  })

  if (result.ok) {
    return { ok: true, workItem: result.workItem }
  }

  // `postJson` reports transport failures without a status.
  if (result.status == null) {
    return {
      ok: false,
      reason: 'network',
      message: result.error ?? 'Request failed'
    }
  }

  return {
    ok: false,
    reason: REASON_BY_STATUS[result.status] ?? 'server',
    status: result.status,
    message:
      result.problem?.detail ??
      result.problem?.title ??
      `Backend returned ${result.status}`
  }
}

/**
 * Duly make a re-accreditation work item (RA-316).
 *
 * Wraps `POST /work-items/re-accreditation/{id}/duly-make`.
 * Body: `{ paymentDate }` — a plain `YYYY-MM-DD` string and nothing else.
 * The backend parses with an exact `yyyy-MM-dd` invariant-culture format
 * and REJECTS a full ISO timestamp, so never widen this to a Date or an
 * `toISOString()`. Charge amount and payment reference are display-only
 * and are ignored if sent.
 *
 * ⚠ UNLIKE THE OTHER CLIENTS HERE, this one surfaces `errorCode` from the
 * ProblemDetails body. The backend distinguishes a user's bad payment date
 * (400 + `errorCode: 'payment-date-*'` + `field: 'paymentDate'`) from a
 * structural failure (404 / 409 / a wrong work item type), and the UI has
 * to tell them apart: the first renders as a GOV.UK error summary bound to
 * the date input, the second as a page-level banner. Collapsing both to
 * `message` — which is what `continueReviewReAccreditation` does, because
 * it has no field to bind to — would make that impossible.
 *
 * `message` still carries the backend's developer-facing `detail` for
 * LOGGING. It is never rendered to the user; the frontend owns the copy.
 */
export async function dulyMakeReAccreditation({
  workItemId,
  paymentDate,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/re-accreditation/${encodeURIComponent(workItemId)}/duly-make`

  const result = await postJson({
    url,
    timeoutMs,
    fetchImpl,
    user,
    body: { paymentDate },
    label: 'dulyMakeReAccreditation'
  })

  if (result.ok) {
    return { ok: true, workItem: result.workItem }
  }

  // `postJson` reports transport failures without a status.
  if (result.status == null) {
    return {
      ok: false,
      reason: 'network',
      message: result.error ?? 'Request failed'
    }
  }

  return {
    ok: false,
    reason: REASON_BY_STATUS[result.status] ?? 'server',
    status: result.status,
    errorCode:
      typeof result.problem?.errorCode === 'string'
        ? result.problem.errorCode
        : null,
    message:
      result.problem?.detail ??
      result.problem?.title ??
      `Backend returned ${result.status}`
  }
}

/**
 * Record a re-accreditation decision (RA-410).
 *
 * Wraps `POST /work-items/re-accreditation/{id}/decision`.
 * Body: `{ outcome }`, where `outcome` is `'approved'` or `'rejected'`.
 *
 * ONE call for both outcomes, and deliberately one call rather than two.
 * The backend applies BOTH hops server-side in a single atomic write —
 * `assessment-in-progress` -> `awaiting-decision` -> terminal — so a failure
 * cannot strand an application half-decided. Do not "helpfully" split this
 * into a `submit-for-decision` action followed by a decision: that is the
 * exact failure mode the combined endpoint exists to remove, and neither
 * underlying transition is caller-invocable any more in any case.
 *
 * `awaiting-decision` is also accepted as an entry state, so replaying this
 * call after a failure completes rather than conflicting. The backend
 * answers an already-decided item with 200 + `x-idempotent-replay: true`
 * when the requested outcome matches, and 409 when it does not — we do not
 * read the header, we just do not treat a repeat as an error.
 *
 * Same result shape as {@link dulyMakeReAccreditation}, including the
 * `errorCode` extension member, so the controller can bind a 400 to the
 * radio group and treat a 409 as a page-level banner.
 */
export async function recordReAccreditationDecision({
  workItemId,
  outcome,
  user = null,
  baseUrl = config.get('backendApi.url'),
  // NOT the shared backendApi.timeoutMs. The backend gates this atomic
  // decision on an operator-journey push it retries up to 5 times (~28s
  // worst case) before committing anything, so this call has its own,
  // much longer budget. Aborting before the backend finishes turns its
  // clean 500 into a client cancellation and re-opens the RA-410
  // stranding bug — see config `backendApi.decisionTimeoutMs`.
  timeoutMs = config.get('backendApi.decisionTimeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/re-accreditation/${encodeURIComponent(workItemId)}/decision`

  const result = await postJson({
    url,
    timeoutMs,
    fetchImpl,
    user,
    body: { outcome },
    label: 'recordReAccreditationDecision'
  })

  if (result.ok) {
    return { ok: true, workItem: result.workItem }
  }

  // `postJson` reports transport failures without a status.
  if (result.status == null) {
    return {
      ok: false,
      reason: 'network',
      message: result.error ?? 'Request failed'
    }
  }

  return {
    ok: false,
    reason: REASON_BY_STATUS[result.status] ?? 'server',
    status: result.status,
    errorCode:
      typeof result.problem?.errorCode === 'string'
        ? result.problem.errorCode
        : null,
    message:
      result.problem?.detail ??
      result.problem?.title ??
      `Backend returned ${result.status}`
  }
}

/**
 * Extend the SLA clock on a work item (RA-131).
 *
 * Wraps `POST /work-items/{id}/sla/extend`.
 * Body: { reason, additionalDuration } (ISO 8601 duration string).
 */
export async function extendWorkItemSla({
  workItemId,
  reason,
  additionalDuration,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/sla/extend`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: buildHeaders(
        { 'content-type': 'application/json', accept: 'application/json' },
        user
      ),
      body: JSON.stringify({ reason, additionalDuration })
    })

    if (response.ok) {
      const workItem = await response.json()
      return { ok: true, workItem }
    }

    const problem = await safeReadJson(response)
    const detail =
      (problem && (problem.detail || problem.title)) ||
      `Backend returned ${response.status}`
    const slaReason = SLA_REASON_BY_STATUS[response.status] ?? 'server'
    return {
      ok: false,
      reason: slaReason,
      status: response.status,
      message: detail
    }
  } catch (error) {
    logger.warn({ err: error, url }, 'Backend API extendWorkItemSla failed')
    return {
      ok: false,
      reason: 'network',
      message: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Override the SLA clock on a work item (RA-131).
 *
 * Wraps `POST /work-items/{id}/sla/override`.
 * Body: { reason, newTargetDuration, newStartedAt } (ISO 8601 duration + datetime).
 */
export async function overrideWorkItemSla({
  workItemId,
  reason,
  newTargetDuration,
  newStartedAt,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/sla/override`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: buildHeaders(
        { 'content-type': 'application/json', accept: 'application/json' },
        user
      ),
      body: JSON.stringify({ reason, newTargetDuration, newStartedAt })
    })

    if (response.ok) {
      const workItem = await response.json()
      return { ok: true, workItem }
    }

    const problem = await safeReadJson(response)
    const detail =
      (problem && (problem.detail || problem.title)) ||
      `Backend returned ${response.status}`
    const slaReason = SLA_REASON_BY_STATUS[response.status] ?? 'server'
    return {
      ok: false,
      reason: slaReason,
      status: response.status,
      message: detail
    }
  } catch (error) {
    logger.warn({ err: error, url }, 'Backend API overrideWorkItemSla failed')
    return {
      ok: false,
      reason: 'network',
      message: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Raise a query against a re-accreditation application (RA-291).
 *
 * Wraps `POST /work-items/re-accreditation/{id}/query`.
 * Body: { sections: string[], reason: string }.
 *
 * The backend resolves the appropriate state transition itself, so no
 * action id is sent. Status mapping matches the vocabulary used by
 * `core/service.js` so controllers can branch on `reason`:
 *
 *  - 400 → { ok: false, reason: 'invalid' }
 *  - 401 → { ok: false, reason: 'unauthorized' }
 *  - 403 → { ok: false, reason: 'not-authorized' }
 *  - 404 → { ok: false, reason: 'not-found' }
 *  - 409 → { ok: false, reason: 'not-allowed' } (wrong state to query)
 *  - other → { ok: false, reason: 'server' }
 *  - network/timeout → { ok: false, reason: 'network' }
 */
export async function raiseWorkItemQuery({
  workItemId,
  sections,
  reason,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/re-accreditation/${encodeURIComponent(workItemId)}/query`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: buildHeaders(
        { 'content-type': 'application/json', accept: 'application/json' },
        user
      ),
      body: JSON.stringify({ sections, reason })
    })

    if (response.ok) {
      const workItem = await response.json()
      return { ok: true, workItem }
    }

    const problem = await safeReadJson(response)
    const detail =
      (problem && (problem.detail || problem.title)) ||
      `Backend returned ${response.status}`
    return {
      ok: false,
      reason: QUERY_REASON_BY_STATUS[response.status] ?? 'server',
      status: response.status,
      message: detail
    }
  } catch (error) {
    logger.warn({ err: error, url }, 'Backend API raiseWorkItemQuery failed')
    return {
      ok: false,
      reason: 'network',
      message: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Update the recycling operation codes on one overseas reprocessing site
 * (RA-469).
 *
 * Wraps `PATCH /work-items/re-accreditation/{id}/overseas-sites/{siteId}/recycling-operations`.
 * Body: { operationCodes: string[] }. The endpoint enforces AC10-AC12
 * (accompanying-code, interim-site, zero-codes) and role/nation-scoping
 * (AC14/AC17) server-side — this client forwards the caller's role/nation
 * as headers (see {@link recyclingOperationsAuthHeaders}) for that check to
 * have anything to check against, then translates the response, using the
 * same shared {@link REASON_BY_STATUS} translation every other
 * type-specific POST/PATCH client here uses.
 *
 * Result shape mirrors {@link extendWorkItemSla}:
 *  - 200 → { ok: true, workItem }
 *  - 400 → { ok: false, reason: 'invalid', status: 400, message }
 *  - 401 → { ok: false, reason: 'unauthorized', status: 401, message }
 *  - 403 → { ok: false, reason: 'forbidden', status: 403, message }
 *  - 404 → { ok: false, reason: 'not-found', status: 404, message }
 *  - 409 → { ok: false, reason: 'conflict', status: 409, message }
 *  - other → { ok: false, reason: 'server', status, message }
 *  - network/timeout → { ok: false, reason: 'network', message }
 */
export async function updateRecyclingOperations({
  workItemId,
  siteId,
  operationCodes,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  // management-be registers this route under its /work-items/re-accreditation
  // group (ReAccreditationEndpoints.cs), not a bare /work-items/{id} path -
  // omitting the type segment 404s at the routing layer before any handler
  // runs (confirmed against a real docker-compose run of both services).
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/re-accreditation/${encodeURIComponent(workItemId)}/overseas-sites/${encodeURIComponent(siteId)}/recycling-operations`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'PATCH',
      signal: controller.signal,
      headers: buildHeaders(
        {
          'content-type': 'application/json',
          accept: 'application/json',
          ...recyclingOperationsAuthHeaders(user)
        },
        user
      ),
      body: JSON.stringify({ operationCodes })
    })

    if (response.ok) {
      const workItem = await response.json()
      return { ok: true, workItem }
    }

    const problem = await safeReadJson(response)
    const detail =
      (problem && (problem.detail || problem.title)) ||
      `Backend returned ${response.status}`
    return {
      ok: false,
      reason: REASON_BY_STATUS[response.status] ?? 'server',
      status: response.status,
      message: detail
    }
  } catch (error) {
    logger.warn(
      { err: error, url },
      'Backend API updateRecyclingOperations failed'
    )
    return {
      ok: false,
      reason: 'network',
      message: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

const QUERY_REASON_BY_STATUS = {
  400: 'invalid',
  401: 'unauthorized',
  403: 'not-authorized',
  404: 'not-found',
  409: 'not-allowed',
  422: 'invalid'
}

const SLA_REASON_BY_STATUS = {
  400: 'invalid',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  409: 'conflict',
  422: 'invalid'
}

/**
 * Submit a brand-new work item of the given type (RA-127).
 *
 * Wraps `POST /work-items` on the backend. The backend wraps every
 * `payload` as opaque BSON so the per-type shape lives in the
 * type-specific service object (Joi schema + form mapping); this client
 * just forwards the envelope `{ typeId, payload, source }` and translates
 * the response to a typed result. RA-219: the backend generates the
 * `applicationReference` server-side and returns it on the created work
 * item — the BFF no longer sends one.
 *
 * Result shape:
 *  - 201 → { ok: true, workItem }
 *  - 400 → { ok: false, reason: 'invalid', status: 400, message, fieldErrors? }
 *  - 401 → { ok: false, reason: 'unauthorized', status: 401, message }
 *  - 403 → { ok: false, reason: 'forbidden', status: 403, message }
 *  - 5xx → { ok: false, reason: 'server', status, message }
 *  - other → { ok: false, reason: 'server', status, message }
 *  - network → { ok: false, reason: 'network', message }
 */
export async function createWorkItem({
  typeId,
  payload,
  source = null,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: buildHeaders(
        {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        user
      ),
      body: JSON.stringify({ typeId, payload, source })
    })

    if (response.status === 201) {
      const workItem = await response.json()
      return { ok: true, workItem }
    }

    const problem = await safeReadJson(response)
    const detail =
      (problem && (problem.detail || problem.title)) ||
      `Backend returned ${response.status}`
    const fieldErrors =
      problem && typeof problem.errors === 'object' && problem.errors !== null
        ? problem.errors
        : undefined

    if (response.status === 400) {
      return {
        ok: false,
        reason: 'invalid',
        status: 400,
        message: detail,
        ...(fieldErrors ? { fieldErrors } : {})
      }
    }
    if (response.status === 401) {
      return {
        ok: false,
        reason: 'unauthorized',
        status: 401,
        message: detail
      }
    }
    if (response.status === 403) {
      return { ok: false, reason: 'forbidden', status: 403, message: detail }
    }
    return {
      ok: false,
      reason: 'server',
      status: response.status,
      message: detail
    }
  } catch (error) {
    logger.warn({ err: error, url }, 'Backend API createWorkItem failed')
    return {
      ok: false,
      reason: 'network',
      message: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch live prior-year accreditation data from ReEx for a re-accreditation
 * work item (RA-209). The backend calls ReEx using the operator organisation
 * and registration identifiers stored in the work item payload.
 *
 * Result shape:
 *  - { ok: true, priorYear }   when prior year data is available
 *  - { ok: false, status: 404 } when the work item has no prior year data
 *                                (created via form, or no matching ReEx record)
 *  - { ok: false, status, error } on other 4xx/5xx
 *  - { ok: false, error }       on transport errors
 */
export async function getReAccreditationPriorYear({
  workItemId,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/re-accreditation/${encodeURIComponent(workItemId)}/prior-year`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: buildHeaders({ accept: 'application/json' }, user)
    })

    if (response.status === 404) {
      return { ok: false, status: 404 }
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Backend returned ${response.status}`
      }
    }

    const priorYear = await response.json()
    return { ok: true, priorYear }
  } catch (error) {
    logger.warn(
      { err: error, url },
      'Backend API getReAccreditationPriorYear failed'
    )
    return {
      ok: false,
      error: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}

async function safeReadJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function postJson({
  url,
  timeoutMs,
  fetchImpl,
  user,
  label,
  body = null,
  method = 'POST'
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const requestInit = {
      method,
      signal: controller.signal,
      headers: buildHeaders({ accept: 'application/json' }, user)
    }
    if (body != null) {
      requestInit.headers['content-type'] = 'application/json'
      requestInit.body = JSON.stringify(body)
    }
    const response = await fetchImpl(url, requestInit)

    if (!response.ok) {
      // Try to surface a problem-details body so callers can render the
      // engine's reason (e.g. "Action not allowed from state 'queried'").
      let problem
      try {
        problem = await response.json()
      } catch {
        problem = undefined
      }
      return { ok: false, status: response.status, problem }
    }

    const workItem = await response.json()
    return { ok: true, workItem }
  } catch (error) {
    logger.warn({ err: error, url }, `Backend API ${label} failed`)
    return {
      ok: false,
      error: error.name === 'AbortError' ? 'Request timed out' : error.message
    }
  } finally {
    clearTimeout(timer)
  }
}
