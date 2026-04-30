import { fetch } from 'undici'

import { config } from '#/config/config.js'
import { createLogger } from '../logging/logger.js'

const logger = createLogger()

const COGNITO_CLIENT_ID_HEADER = 'x-cdp-cognito-client-id'
const USER_ID_HEADER = 'x-cdp-user-id'
const USER_NAME_HEADER = 'x-cdp-user-name'
const USER_ROLES_HEADER = 'x-cdp-user-roles'

// Backend-side role that bypasses the per-tenant submittedBy filter. The
// case-management FE is, by definition, a case-worker portal — anyone who
// has authenticated into this BFF is a case worker — so we always forward
// it. This is independent of the FE-level scopes (`standard`, `assign`)
// which still drive UI gating inside the BFF.
const BACKEND_CASE_WORKER_ROLE = 'case-worker'

/**
 * Build the headers attached to every backend call. The Cognito client id
 * identifies the BFF *as a service* and is required (CDP itself adds it on
 * service-to-service calls); the optional user-* headers forward the
 * acting end-user's identity and role membership so the backend can make
 * role-based decisions and produce useful audit lines.
 */
function buildHeaders(extra = {}, user = null) {
  const headers = { ...extra }
  const clientId = config.get('backendApi.cognitoClientId')
  if (clientId) {
    headers[COGNITO_CLIENT_ID_HEADER] = clientId
  }
  if (user) {
    if (user.id) headers[USER_ID_HEADER] = String(user.id)
    if (user.name) headers[USER_NAME_HEADER] = String(user.name)
    const roles = Array.isArray(user.roles) ? [...user.roles] : []
    if (!roles.includes(BACKEND_CASE_WORKER_ROLE)) {
      roles.push(BACKEND_CASE_WORKER_ROLE)
    }
    headers[USER_ROLES_HEADER] = roles.join(',')
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
    const response = await fetchImpl(url, { signal: controller.signal })
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
  search,
  assigneeId,
  unassigned,
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
    search,
    assigneeId,
    unassigned,
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
      return { ok: false, status: response.status, error: `Backend returned ${response.status}` }
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

function buildWorkItemsUrl(baseUrl, { typeIds, stateIds, search, assigneeId, unassigned, page, pageSize }) {
  const root = `${baseUrl.replace(/\/$/, '')}/work-items`
  const params = new URLSearchParams()

  for (const typeId of toArray(typeIds)) {
    if (typeId) params.append('typeId', typeId)
  }
  for (const stateId of toArray(stateIds)) {
    if (stateId) params.append('stateId', stateId)
  }
  if (search && String(search).trim() !== '') {
    params.append('search', String(search).trim())
  }
  if (assigneeId && String(assigneeId).trim() !== '') {
    params.append('assigneeId', String(assigneeId).trim())
  }
  if (unassigned === true) {
    params.append('unassigned', 'true')
  }
  if (page != null && page !== '') params.append('page', String(page))
  if (pageSize != null && pageSize !== '') params.append('pageSize', String(pageSize))

  const qs = params.toString()
  return qs === '' ? root : `${root}?${qs}`
}

function toArray(value) {
  if (value == null) return []
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
      totalCount: typeof body.totalCount === 'number' ? body.totalCount : body.items.length,
      page: typeof body.page === 'number' ? body.page : 1,
      pageSize: typeof body.pageSize === 'number' ? body.pageSize : body.items.length
    }
  }
  return { ok: true, items: [], totalCount: 0, page: 1, pageSize: 0 }
}

/**
 * Fetch a single work item by id.
 *
 * Returns the backend's `WorkItemResponse` shape so the caller can render
 * the full envelope (id, type, state, payload, templateVersion) plus engine
 * projection (tasks, availableActions). Result shape:
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
      return { ok: false, status: response.status, error: `Backend returned ${response.status}` }
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
 * Mark a task as complete on a work item.
 *
 * The backend's task & state engine validates the call and replies with the
 * updated `WorkItemResponse` (including refreshed `tasks` and
 * `availableActions`). Failure shapes:
 *  - { ok: false, status: 404, ... } when the work item does not exist
 *  - { ok: false, status, problem } when the engine rejects the call
 *  - { ok: false, error } on transport errors
 */
export async function completeWorkItemTask({
  workItemId,
  taskId,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/tasks/${encodeURIComponent(taskId)}/complete`
  return postJson({ url, timeoutMs, fetchImpl, user, label: 'completeWorkItemTask' })
}

/**
 * Set a task's lifecycle status (epr-gl6) on a work item.
 *
 * `status` is the `WorkItemTaskStatus` name (`NotStarted` | `InProgress` |
 * `Blocked` | `Completed`); the backend binds case-insensitively. Same
 * response shape as {@link completeWorkItemTask}: `{ ok: true, workItem }`
 * on success, `{ ok: false, status, problem }` for engine rejections, and
 * `{ ok: false, error }` on transport errors.
 */
export async function setWorkItemTaskStatus({
  workItemId,
  taskId,
  status,
  user = null,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/tasks/${encodeURIComponent(taskId)}/status`
  return postJson({
    url,
    method: 'PUT',
    timeoutMs,
    fetchImpl,
    user,
    label: 'setWorkItemTaskStatus',
    body: { status }
  })
}

/**
 * Invoke a named action (e.g. "approve", "reject") against a work item.
 * Same response shape as {@link completeWorkItemTask}.
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
  return postJson({ url, timeoutMs, fetchImpl, user, label: 'applyWorkItemAction' })
}

/**
 * Assign (or re-assign) a work item to a user. The backend enforces the
 * role-based rules; this client just forwards the request and the acting
 * user's identity / roles.
 *
 * Same response shape as {@link completeWorkItemTask}, with the addition
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
  return postJson({ url, timeoutMs, fetchImpl, user, label: 'unassignWorkItem' })
}

/**
 * Append a free-text note to a work item (RA-96). The backend snapshots
 * the acting user's id and name (forwarded via the standard user-* headers)
 * onto the note for an immutable audit narrative. Same response shape as
 * {@link completeWorkItemTask} — the updated `WorkItemResponse`, including
 * the freshly-appended note projected newest-first under `notes`.
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

async function postJson({ url, timeoutMs, fetchImpl, user, label, body = null, method = 'POST' }) {
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
      // engine's reason (e.g. "Action not allowed: tasks outstanding").
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
