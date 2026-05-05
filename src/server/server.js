import path from 'path'
import hapi from '@hapi/hapi'
import Scooter from '@hapi/scooter'

import { router } from './plugins/router.js'
import { config } from '#/config/config.js'
import { pulse } from './plugins/pulse.js'
import { catchAll } from './common/helpers/errors.js'
import { nunjucksConfig } from '#/config/nunjucks/nunjucks.js'
import {
  setupProxyEnv,
  installProxyDispatcher
} from './common/helpers/proxy/setup-proxy.js'
import { requestTracing } from './plugins/request-tracing.js'
import { requestLogger } from './plugins/request-logger.js'
import { sessionCache } from './plugins/session-cache.js'
import { getCacheEngine } from './common/helpers/session-cache/cache-engine.js'
import { secureContext } from '@defra/hapi-secure-context'
import { contentSecurityPolicy } from './plugins/content-security-policy.js'
import { csrfProtection } from './plugins/csrf.js'
import { metrics } from '@defra/cdp-metrics'
import { selectAuthPlugin } from './plugins/select-auth-plugin.js'
import { authRoutes } from './routes/auth/index.js'

export async function createServer() {
  // Wire HTTP_PROXY/HTTPS_PROXY env vars onto global-agent up front so
  // any legacy HTTP client constructed during plugin registration sees
  // them. The undici dispatcher is installed later — see below.
  setupProxyEnv()
  const server = hapi.server({
    host: config.get('host'),
    port: config.get('port'),
    routes: {
      validate: {
        options: {
          abortEarly: false
        }
      },
      files: {
        relativeTo: path.resolve(config.get('root'), '.public')
      },
      security: {
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false
        },
        xss: 'enabled',
        noSniff: true,
        xframe: true
      }
    },
    router: {
      stripTrailingSlash: true
    },
    cache: [
      {
        name: config.get('session.cache.name'),
        engine: getCacheEngine(config.get('session.cache.engine'))
      }
    ],
    state: {
      strictHeader: false
    }
  })
  const authToRegister = selectAuthPlugin()

  await server.register([
    requestLogger,
    requestTracing,
    metrics,
    secureContext,
    pulse,
    sessionCache,
    authToRegister,
    nunjucksConfig,
    Scooter,
    contentSecurityPolicy,
    csrfProtection,
    authRoutes,
    router // Register all the controllers/routes defined in src/server/router.js
  ])

  // ORDERING INVARIANT: install the undici proxy dispatcher only AFTER
  // `@defra/hapi-secure-context` has registered (above) so the CDP CA
  // bundle is loaded into Node's trust store before any outbound TLS
  // handshake occurs. Reversing this would break HTTPS to CDP-internal
  // hosts (e.g. the backend API) when running in deployed environments.
  installProxyDispatcher()

  server.ext('onPreResponse', catchAll)

  return server
}
