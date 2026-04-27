import { fetch } from 'undici'

import { config } from '#/config/config.js'
import { createLogger } from '../logging/logger.js'

const logger = createLogger()

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
