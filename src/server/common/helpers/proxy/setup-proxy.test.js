import { getGlobalDispatcher, setGlobalDispatcher, ProxyAgent } from 'undici'

import {
  installProxyDispatcher,
  setupProxy,
  setupProxyEnv
} from './setup-proxy.js'
import { config } from '../../../../config/config.js'

describe('proxy setup', () => {
  let originalDispatcher
  let originalGlobalAgent

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher()
    // Snapshot global-agent state so each test starts clean.
    originalGlobalAgent = global.GLOBAL_AGENT
      ? { ...global.GLOBAL_AGENT }
      : undefined
    if (global.GLOBAL_AGENT) {
      delete global.GLOBAL_AGENT.HTTP_PROXY
      delete global.GLOBAL_AGENT.HTTPS_PROXY
    }
  })

  afterEach(() => {
    config.set('httpProxy', null)
    config.set('httpsProxy', null)
    setGlobalDispatcher(originalDispatcher)
    if (originalGlobalAgent === undefined) {
      delete global.GLOBAL_AGENT
    } else {
      global.GLOBAL_AGENT = originalGlobalAgent
    }
  })

  describe('setupProxy', () => {
    test('does nothing when neither HTTP_PROXY nor HTTPS_PROXY is set', () => {
      config.set('httpProxy', null)
      config.set('httpsProxy', null)

      setupProxy()

      expect(global.GLOBAL_AGENT?.HTTP_PROXY).toBeUndefined()
      expect(global.GLOBAL_AGENT?.HTTPS_PROXY).toBeUndefined()
      expect(getGlobalDispatcher()).not.toBeInstanceOf(ProxyAgent)
    })

    test('uses HTTP_PROXY for both env vars and undici when only HTTP_PROXY is set', () => {
      config.set('httpProxy', 'http://localhost:8080')
      config.set('httpsProxy', null)

      setupProxy()

      expect(global.GLOBAL_AGENT.HTTP_PROXY).toBe('http://localhost:8080')
      // global-agent's HTTPS_PROXY falls back to HTTP_PROXY so HTTPS
      // traffic via legacy clients also goes through the proxy.
      expect(global.GLOBAL_AGENT.HTTPS_PROXY).toBe('http://localhost:8080')
      expect(getGlobalDispatcher()).toBeInstanceOf(ProxyAgent)
    })

    test('uses HTTPS_PROXY for undici and global-agent when only HTTPS_PROXY is set', () => {
      config.set('httpProxy', null)
      config.set('httpsProxy', 'http://localhost:8443')

      setupProxy()

      // global-agent's bootstrap initialises HTTP_PROXY to null when not
      // explicitly set; we only care that we did not assign a real URL.
      expect(global.GLOBAL_AGENT.HTTP_PROXY ?? null).toBeNull()
      expect(global.GLOBAL_AGENT.HTTPS_PROXY).toBe('http://localhost:8443')
      expect(getGlobalDispatcher()).toBeInstanceOf(ProxyAgent)
    })

    test('prefers HTTPS_PROXY for undici dispatcher when both are set, keeps HTTP_PROXY for plain HTTP', () => {
      config.set('httpProxy', 'http://localhost:8080')
      config.set('httpsProxy', 'http://localhost:8443')

      setupProxy()

      expect(global.GLOBAL_AGENT.HTTP_PROXY).toBe('http://localhost:8080')
      expect(global.GLOBAL_AGENT.HTTPS_PROXY).toBe('http://localhost:8443')
      expect(getGlobalDispatcher()).toBeInstanceOf(ProxyAgent)
    })
  })

  describe('split helpers', () => {
    test('setupProxyEnv wires global-agent without installing undici dispatcher', () => {
      config.set('httpProxy', 'http://localhost:8080')
      config.set('httpsProxy', 'http://localhost:8443')

      setupProxyEnv()

      expect(global.GLOBAL_AGENT.HTTP_PROXY).toBe('http://localhost:8080')
      expect(global.GLOBAL_AGENT.HTTPS_PROXY).toBe('http://localhost:8443')
      // Critical: dispatcher must NOT be installed by setupProxyEnv —
      // it's deferred until after secureContext registers the CA bundle.
      expect(getGlobalDispatcher()).not.toBeInstanceOf(ProxyAgent)
    })

    test('installProxyDispatcher installs the undici ProxyAgent', () => {
      config.set('httpProxy', null)
      config.set('httpsProxy', 'http://localhost:8443')

      installProxyDispatcher()

      expect(getGlobalDispatcher()).toBeInstanceOf(ProxyAgent)
    })

    test('installProxyDispatcher does nothing when no proxy is configured', () => {
      config.set('httpProxy', null)
      config.set('httpsProxy', null)

      installProxyDispatcher()

      expect(getGlobalDispatcher()).not.toBeInstanceOf(ProxyAgent)
    })
  })
})
