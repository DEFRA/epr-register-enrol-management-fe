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
