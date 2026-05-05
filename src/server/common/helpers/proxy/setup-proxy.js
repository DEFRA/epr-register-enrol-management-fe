import { ProxyAgent, setGlobalDispatcher } from 'undici'
import { bootstrap } from 'global-agent'

import { createLogger } from '../logging/logger.js'
import { config } from '../../../../config/config.js'

const logger = createLogger()

function readProxyUrls() {
  return {
    httpProxy: config.get('httpProxy'),
    httpsProxy: config.get('httpsProxy')
  }
}

/**
 * Wire HTTP_PROXY / HTTPS_PROXY env vars onto `global-agent` so legacy
 * HTTP clients (axios, request, etc.) route via the CDP forward proxy.
 *
 * Safe to call before `@defra/hapi-secure-context` registers the CDP CA
 * bundle: this only mutates env-var-shaped state and does not perform
 * any TLS handshakes.
 */
export function setupProxyEnv() {
  const { httpProxy, httpsProxy } = readProxyUrls()

  if (!httpProxy && !httpsProxy) {
    return
  }

  bootstrap()

  if (httpProxy) {
    global.GLOBAL_AGENT.HTTP_PROXY = httpProxy
  }
  // HTTPS_PROXY falls back to HTTP_PROXY if not separately configured —
  // matches the behaviour curl/Node expect for the CDP proxy contract.
  global.GLOBAL_AGENT.HTTPS_PROXY = httpsProxy ?? httpProxy ?? null

  logger.info('proxy env vars wired onto global-agent')
}

/**
 * Install undici's global ProxyAgent so the `fetch` exported from
 * `undici` (and therefore the backend client) routes via the CDP
 * forward proxy.
 *
 * MUST be called AFTER `@defra/hapi-secure-context` is registered so
 * the CDP CA bundle is loaded into Node's trust store before any
 * outbound TLS handshake. Calling it earlier would attempt to verify
 * CDP-internal TLS without the CA bundle and fail.
 *
 * Prefers HTTPS_PROXY (the common case — backend calls are HTTPS in
 * deployed envs) and falls back to HTTP_PROXY.
 */
export function installProxyDispatcher() {
  const { httpProxy, httpsProxy } = readProxyUrls()
  const dispatcherUrl = httpsProxy ?? httpProxy

  if (!dispatcherUrl) {
    return
  }

  setGlobalDispatcher(new ProxyAgent(dispatcherUrl))
  logger.info('undici global proxy dispatcher installed')
}

/**
 * Convenience wrapper that performs both halves of proxy setup. Kept
 * for backwards compatibility; new call sites should use
 * {@link setupProxyEnv} early in boot and
 * {@link installProxyDispatcher} after secureContext has registered.
 */
export function setupProxy() {
  setupProxyEnv()
  installProxyDispatcher()
}
