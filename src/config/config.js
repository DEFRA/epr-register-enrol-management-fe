import convict from 'convict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import convictFormatWithValidator from 'convict-format-with-validator'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const fourHoursMs = 14400000
const oneWeekMs = 604800000

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const isDevelopment = process.env.NODE_ENV === 'development'

// Public placeholder shipped as the development default for
// SESSION_COOKIE_PASSWORD. It is intentionally well-known so that local
// dev works out of the box; it MUST never be used in any environment
// where the cookie is treated as secure (i.e. anywhere we'd be relying on
// it to sign/encrypt session data). The hardening assertion below rejects
// it whenever the cookie is configured as secure or we're in production.
export const PLACEHOLDER_SESSION_COOKIE_PASSWORD =
  'the-password-must-be-at-least-32-characters-long'

// Pino redaction paths applied to logs in production. Keep this list in
// one place so it is easy to audit. Includes the user-identity headers
// the BFF forwards to the backend (epr-zld) — these can carry PII (full
// name, internal user id) and must not land in shipped logs.
export const PRODUCTION_LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-cdp-user-id"]',
  'req.headers["x-cdp-user-name"]',
  'res.headers'
]

convict.addFormats(convictFormatWithValidator)

// Custom format that enforces @hapi/iron's minimum key length (32 chars)
// at convict validation time, regardless of environment. This catches
// short secrets at boot rather than waiting for the first request to
// hit @hapi/iron's runtime check.
convict.addFormat({
  name: 'session-cookie-password',
  validate(value) {
    if (typeof value !== 'string' || value.length < 32) {
      throw new Error('must be a string of at least 32 characters')
    }
  }
})

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3000,
    env: 'PORT'
  },
  staticCacheTimeout: {
    doc: 'Static cache timeout in milliseconds',
    format: Number,
    default: oneWeekMs,
    env: 'STATIC_CACHE_TIMEOUT'
  },
  serviceName: {
    doc: 'Applications Service Name',
    format: String,
    default: 'EPR Register Case Management'
  },
  root: {
    doc: 'Project root',
    format: String,
    default: path.resolve(dirname, '../..')
  },
  assetPath: {
    doc: 'Asset path',
    format: String,
    default: '/public',
    env: 'ASSET_PATH'
  },
  isProduction: {
    doc: 'If this application running in the production environment',
    format: Boolean,
    default: isProduction
  },
  isDevelopment: {
    doc: 'If this application running in the development environment',
    format: Boolean,
    default: isDevelopment
  },
  isTest: {
    doc: 'If this application running in the test environment',
    format: Boolean,
    default: isTest
  },
  log: {
    enabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: process.env.NODE_ENV !== 'test',
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in.',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction ? PRODUCTION_LOG_REDACT_PATHS : [],
      env: 'LOG_REDACT'
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  httpsProxy: {
    doc: 'HTTPS Proxy. Used by undici dispatcher for HTTPS calls (the common case for backend traffic in deployed envs). Falls back to HTTP_PROXY if unset.',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTPS_PROXY'
  },
  isSecureContextEnabled: {
    doc: 'Enable Secure Context',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_SECURE_CONTEXT'
  },
  session: {
    cache: {
      engine: {
        doc: 'backend cache is written to',
        format: ['redis', 'memory'],
        default: isProduction ? 'redis' : 'memory',
        env: 'SESSION_CACHE_ENGINE'
      },
      name: {
        doc: 'server side session cache name',
        format: String,
        default: 'session',
        env: 'SESSION_CACHE_NAME'
      },
      ttl: {
        doc: 'server side session cache ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_CACHE_TTL'
      }
    },
    cookie: {
      ttl: {
        doc: 'Session cookie ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_COOKIE_TTL'
      },
      password: {
        doc: 'session cookie password',
        format: 'session-cookie-password',
        default: 'the-password-must-be-at-least-32-characters-long',
        env: 'SESSION_COOKIE_PASSWORD',
        sensitive: true
      },
      secure: {
        doc: 'set secure flag on cookie',
        format: Boolean,
        default: isProduction,
        env: 'SESSION_COOKIE_SECURE'
      }
    }
  },
  redis: {
    host: {
      doc: 'Redis cache host',
      format: String,
      default: '127.0.0.1',
      env: 'REDIS_HOST'
    },
    username: {
      doc: 'Redis cache username',
      format: String,
      default: '',
      env: 'REDIS_USERNAME'
    },
    password: {
      doc: 'Redis cache password',
      format: '*',
      default: '',
      sensitive: true,
      env: 'REDIS_PASSWORD'
    },
    keyPrefix: {
      doc: 'Redis cache key prefix name used to isolate the cached results across multiple clients',
      format: String,
      default: 'epr-register-case-management:',
      env: 'REDIS_KEY_PREFIX'
    },
    useSingleInstanceCache: {
      doc: 'Connect to a single instance of redis instead of a cluster.',
      format: Boolean,
      default: !isProduction,
      env: 'USE_SINGLE_INSTANCE_CACHE'
    },
    useTLS: {
      doc: 'Connect to redis using TLS',
      format: Boolean,
      default: isProduction,
      env: 'REDIS_TLS'
    }
  },
  nunjucks: {
    watch: {
      doc: 'Reload templates when they are changed.',
      format: Boolean,
      default: isDevelopment
    },
    noCache: {
      doc: 'Use a cache and recompile templates each time',
      format: Boolean,
      default: isDevelopment
    }
  },
  tracing: {
    header: {
      doc: 'Which header to track',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  backendApi: {
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
    cognitoClientId: {
      doc: 'CDP Cognito client id sent on outbound calls to the backend (x-cdp-cognito-client-id header). Empty string disables the header.',
      format: String,
      default: 'frontend',
      env: 'BACKEND_API_COGNITO_CLIENT_ID'
    }
  },
  environment: {
    doc: 'Deployment environment name',
    format: [
      'local',
      'infra-dev',
      'management',
      'dev',
      'test',
      'perf-test',
      'ext-test',
      'prod'
    ],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  featureFlags: {
    workItemCreationEnabled: {
      doc: 'RA-127. Enable the demo "create a work item" form. Enabled by default; opt-out via WORK_ITEM_CREATION_ENABLED=false.',
      format: Boolean,
      default: true,
      env: 'WORK_ITEM_CREATION_ENABLED'
    }
  },
  auth: {
    stubEnabled: {
      doc: 'Enable stub auth (bypasses real OAuth). Defaults true for non-prod.',
      format: Boolean,
      default: process.env.ENVIRONMENT !== 'prod',
      env: 'AUTH_STUB_ENABLED'
    },
    callbackBaseUrl: {
      doc: 'Base URL for OAuth callback URLs (e.g. https://myapp.example.com)',
      format: String,
      default: 'http://localhost:3000',
      env: 'AUTH_CALLBACK_BASE_URL'
    },
    sharedSecret: {
      doc: 'HMAC-SHA256 shared secret for backend request signing (AUTH_SHARED_SECRET). Empty string disables signing (local dev).',
      format: String,
      default: '',
      env: 'AUTH_SHARED_SECRET',
      sensitive: true
    },
    azureEntraId: {
      clientId: {
        format: String,
        default: '',
        env: 'AZURE_CLIENT_ID',
        sensitive: true
      },
      clientSecret: {
        format: String,
        default: '',
        env: 'AZURE_CLIENT_SECRET',
        sensitive: true
      },
      tenantId: {
        format: String,
        default: '',
        env: 'AZURE_TENANT_ID'
      }
    }
  }
})

config.validate({ allowed: 'strict' })

// Production hardening: refuse to boot with insecure defaults.
//
// 1. SESSION_COOKIE_PASSWORD: convict only validates the length (>=32),
//    not that the operator actually supplied a unique secret. If the env
//    var is missing in a deployed env we'd silently fall back to the
//    publicly known placeholder default, signing/encrypting session data
//    with a key anyone can read on GitHub.
// 2. AUTH_STUB_ENABLED: the stub auth provider auto-authenticates every
//    request as a fixed test user and bypasses real OAuth — it must
//    never be enabled in production.
//
// Both checks throw at module-load time so the process fails loudly
// during boot rather than serving traffic with a known-bad config.
const sessionCookieSecure = config.get('session.cookie.secure')
const sessionCookiePassword = config.get('session.cookie.password')

if (
  (config.get('isProduction') || sessionCookieSecure) &&
  sessionCookiePassword === PLACEHOLDER_SESSION_COOKIE_PASSWORD
) {
  throw new Error(
    'SESSION_COOKIE_PASSWORD must be set to a unique per-environment secret ' +
      '(>=32 chars) via Secrets Manager. The placeholder default is not ' +
      'permitted when SESSION_COOKIE_SECURE is true or NODE_ENV=production.'
  )
}

if (config.get('environment') === 'prod' && config.get('auth.stubEnabled')) {
  throw new Error(
    'AUTH_STUB_ENABLED must be false when ENVIRONMENT=prod. The stub auth ' +
      'provider bypasses real OAuth and auto-authenticates every request.'
  )
}

// 3. AZURE_CLIENT_ID / AZURE_CLIENT_SECRET: when real OAuth is in use
//    (production with stub disabled) the Azure Entra ID credentials must
//    be supplied. The convict defaults are empty strings so dev/test
//    work without secrets; an empty value reaching production means a
//    missing Secrets Manager wiring and would fail opaquely on first
//    login. Fail loudly at boot instead.
if (config.get('isProduction') && !config.get('auth.stubEnabled')) {
  if (!config.get('auth.azureEntraId.clientId')) {
    throw new Error(
      'AZURE_CLIENT_ID (auth.azureEntraId.clientId) must be set in ' +
        'production when AUTH_STUB_ENABLED is false. Wire the value via ' +
        'Secrets Manager.'
    )
  }
  if (!config.get('auth.azureEntraId.clientSecret')) {
    throw new Error(
      'AZURE_CLIENT_SECRET (auth.azureEntraId.clientSecret) must be set ' +
        'in production when AUTH_STUB_ENABLED is false. Wire the value ' +
        'via Secrets Manager.'
    )
  }
}

// 4. AUTH_SHARED_SECRET: the HMAC key used to sign outbound backend requests.
//    Without it the backend rejects every call with 401 in all non-local
//    environments. The default is an empty string so local dev works without
//    secrets, but an empty value in a deployed environment means missing
//    Secrets Manager wiring and would fail opaquely at request time.
if (
  config.get('environment') !== 'local' &&
  !config.get('auth.sharedSecret')
) {
  throw new Error(
    'AUTH_SHARED_SECRET must be set via Secrets Manager in deployed ' +
      'environments. The backend will reject all requests with 401 without ' +
      'a valid HMAC signature.'
  )
}

// 5. REDIS_HOST / REDIS_USERNAME / REDIS_PASSWORD: convict defaults
//    target local dev (host=127.0.0.1, empty username/password). In a
//    deployed env the cache must point at Elasticache over TLS with
//    real credentials. The redis client in
//    src/server/common/helpers/redis-client.js silently drops
//    credentials when the username is empty, so a missing
//    REDIS_USERNAME would cause REDIS_PASSWORD to be ignored too.
//    Fail loudly at boot whenever production OR TLS is active.
const redisUseTLS = config.get('redis.useTLS')
if (config.get('isProduction') || redisUseTLS) {
  const redisHost = config.get('redis.host')
  if (!redisHost || redisHost === 'localhost' || redisHost === '127.0.0.1') {
    throw new Error(
      'REDIS_HOST (redis.host) must be set to a routable Elasticache ' +
        'endpoint in production or when REDIS_TLS is true. Localhost / ' +
        '127.0.0.1 / empty values are not permitted.'
    )
  }
  if (!config.get('redis.username')) {
    throw new Error(
      'REDIS_USERNAME (redis.username) must be set in production or when ' +
        'REDIS_TLS is true. The redis client treats an empty username as ' +
        '"no auth" and silently drops REDIS_PASSWORD. Wire the value via ' +
        'Secrets Manager.'
    )
  }
  if (!config.get('redis.password')) {
    throw new Error(
      'REDIS_PASSWORD (redis.password) must be set in production or when ' +
        'REDIS_TLS is true. Wire the value via Secrets Manager.'
    )
  }
}
