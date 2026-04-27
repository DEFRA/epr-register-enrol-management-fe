import { fetch } from 'undici'

import { config } from '#/config/config.js'
import { createLogger } from '../logging/logger.js'

const logger = createLogger()

const COGNITO_CLIENT_ID_HEADER = 'x-cdp-cognito-client-id'

function buildHeaders(extra = {}) {
  const headers = { ...extra }
  const clientId = config.get('backendApi.cognitoClientId')
  if (clientId) {
    headers[COGNITO_CLIENT_ID_HEADER] = clientId
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
 * Fetches every work item from the case management backend.
 *
 * Returns an object describing the result:
 *  - { ok: true, items }              when the backend responds with a list
 *  - { ok: false, status?, error }    when the request fails or returns non-2xx
 *
 * Items are returned as the backend's `WorkItemResponse` shape:
 *   { id, typeId, stateId, submittedAt, submittedBy, payload }
 */
export async function getWorkItems({
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
} = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: buildHeaders({ accept: 'application/json' })
    })

    if (!response.ok) {
      return { ok: false, status: response.status, error: `Backend returned ${response.status}` }
    }

    const items = await response.json()
    return { ok: true, items: Array.isArray(items) ? items : [] }
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
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/tasks/${encodeURIComponent(taskId)}/complete`
  return postJson({ url, timeoutMs, fetchImpl, label: 'completeWorkItemTask' })
}

/**
 * Invoke a named action (e.g. "approve", "reject") against a work item.
 * Same response shape as {@link completeWorkItemTask}.
 */
export async function applyWorkItemAction({
  workItemId,
  actionId,
  baseUrl = config.get('backendApi.url'),
  timeoutMs = config.get('backendApi.timeoutMs'),
  fetchImpl = fetch
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/work-items/${encodeURIComponent(workItemId)}/actions/${encodeURIComponent(actionId)}`
  return postJson({ url, timeoutMs, fetchImpl, label: 'applyWorkItemAction' })
}

async function postJson({ url, timeoutMs, fetchImpl, label }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: buildHeaders({ accept: 'application/json' })
    })

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
