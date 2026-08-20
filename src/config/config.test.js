import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

const PLACEHOLDER = 'the-password-must-be-at-least-32-characters-long'
const REAL_SECRET = 'a'.repeat(48)

// The hardening assertions live at module-load time so the process
// fails loudly during boot. Each test re-imports the module under a
// fresh process.env so we exercise the real boot path.
describe('config production hardening', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    // Start from a clean slate so leftover env vars from the test
    // runner (NODE_ENV=test) don't bleed into production scenarios.
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('production boot rejects the placeholder SESSION_COOKIE_PASSWORD', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'prod'
    process.env.AUTH_STUB_ENABLED = 'false'
    delete process.env.SESSION_COOKIE_PASSWORD

    await expect(import('./config.js')).rejects.toThrow(
      /SESSION_COOKIE_PASSWORD/
    )
  })

  test('production boot rejects AUTH_STUB_ENABLED=true', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'prod'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'true'

    await expect(import('./config.js')).rejects.toThrow(/AUTH_STUB_ENABLED/)
  })

  test('non-prod boot accepts the placeholder SESSION_COOKIE_PASSWORD', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    delete process.env.SESSION_COOKIE_PASSWORD
    delete process.env.SESSION_COOKIE_SECURE
    delete process.env.AUTH_STUB_ENABLED

    const mod = await import('./config.js')
    expect(mod.config.get('session.cookie.password')).toBe(PLACEHOLDER)
    expect(mod.config.get('session.cookie.secure')).toBe(false)
    expect(mod.config.get('isProduction')).toBe(false)
  })

  test('production boot succeeds when SESSION_COOKIE_PASSWORD is set and stub auth disabled', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'prod'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'false'
    process.env.ENTRA_CLIENT_ID = 'azure-client-id'
    process.env.ENTRA_CLIENT_SECRET = 'azure-client-secret'
    process.env.BACKEND_API_SHARED_SECRET = 'a-shared-secret'
    process.env.AUTH_CALLBACK_BASE_URL = 'https://app.example.com'
    process.env.REDIS_HOST = 'redis.example.internal'
    process.env.REDIS_USERNAME = 'redis-user'
    process.env.REDIS_PASSWORD = 'redis-password'

    const mod = await import('./config.js')
    expect(mod.config.get('isProduction')).toBe(true)
    expect(mod.config.get('auth.stubEnabled')).toBe(false)
    expect(mod.config.get('session.cookie.password')).toBe(REAL_SECRET)
  })

  test('production boot rejects empty ENTRA_CLIENT_ID when stub auth disabled', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'prod'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'false'
    delete process.env.ENTRA_CLIENT_ID
    process.env.ENTRA_CLIENT_SECRET = 'azure-client-secret'

    await expect(import('./config.js')).rejects.toThrow(/ENTRA_CLIENT_ID/)
  })

  test('production boot rejects empty ENTRA_CLIENT_SECRET when stub auth disabled', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'prod'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'false'
    process.env.ENTRA_CLIENT_ID = 'azure-client-id'
    delete process.env.ENTRA_CLIENT_SECRET

    await expect(import('./config.js')).rejects.toThrow(/ENTRA_CLIENT_SECRET/)
  })

  test('production boot with ENVIRONMENT=dev allows AUTH_STUB_ENABLED=true', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'dev'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'true'
    delete process.env.ENTRA_CLIENT_ID
    delete process.env.ENTRA_CLIENT_SECRET
    process.env.BACKEND_API_SHARED_SECRET = 'a-shared-secret'
    process.env.AUTH_CALLBACK_BASE_URL = 'https://app.example.com'
    process.env.REDIS_HOST = 'redis.example.internal'
    process.env.REDIS_USERNAME = 'redis-user'
    process.env.REDIS_PASSWORD = 'redis-password'

    const mod = await import('./config.js')
    expect(mod.config.get('auth.stubEnabled')).toBe(true)
    expect(mod.config.get('isProduction')).toBe(true)
  })

  test('Azure creds are not required when AUTH_STUB_ENABLED=true in non-prod ENVIRONMENT', async () => {
    // Proves the Azure creds guard is gated on !stubEnabled, not on isProduction.
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'dev'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'true'
    delete process.env.ENTRA_CLIENT_ID
    delete process.env.ENTRA_CLIENT_SECRET
    process.env.BACKEND_API_SHARED_SECRET = 'a-shared-secret'
    process.env.AUTH_CALLBACK_BASE_URL = 'https://app.example.com'
    process.env.REDIS_HOST = 'redis.example.internal'
    process.env.REDIS_USERNAME = 'redis-user'
    process.env.REDIS_PASSWORD = 'redis-password'

    const err = await import('./config.js').then(
      () => null,
      (e) => e
    )
    expect(err).toBeNull()
  })

  test('deployed boot rejects missing BACKEND_API_SHARED_SECRET in non-local environments', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'dev'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'true'
    delete process.env.BACKEND_API_SHARED_SECRET
    process.env.REDIS_HOST = 'redis.example.internal'
    process.env.REDIS_USERNAME = 'redis-user'
    process.env.REDIS_PASSWORD = 'redis-password'

    await expect(import('./config.js')).rejects.toThrow(
      /BACKEND_API_SHARED_SECRET/
    )
  })

  test('deployed boot rejects the localhost default AUTH_CALLBACK_BASE_URL in non-local environments', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'dev'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'true'
    process.env.BACKEND_API_SHARED_SECRET = 'a-shared-secret'
    delete process.env.AUTH_CALLBACK_BASE_URL
    process.env.REDIS_HOST = 'redis.example.internal'
    process.env.REDIS_USERNAME = 'redis-user'
    process.env.REDIS_PASSWORD = 'redis-password'

    await expect(import('./config.js')).rejects.toThrow(
      /AUTH_CALLBACK_BASE_URL/
    )
  })

  test('deployed boot succeeds when AUTH_CALLBACK_BASE_URL is set to the real domain', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'dev'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'true'
    process.env.BACKEND_API_SHARED_SECRET = 'a-shared-secret'
    process.env.AUTH_CALLBACK_BASE_URL =
      'https://epr-register-enrol-management-fe.dev.cdp-int.defra.cloud'
    process.env.REDIS_HOST = 'redis.example.internal'
    process.env.REDIS_USERNAME = 'redis-user'
    process.env.REDIS_PASSWORD = 'redis-password'

    const mod = await import('./config.js')
    expect(mod.config.get('auth.callbackBaseUrl')).toBe(
      'https://epr-register-enrol-management-fe.dev.cdp-int.defra.cloud'
    )
  })

  test('local boot succeeds without BACKEND_API_SHARED_SECRET', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    delete process.env.BACKEND_API_SHARED_SECRET
    delete process.env.SESSION_COOKIE_PASSWORD
    delete process.env.SESSION_COOKIE_SECURE
    delete process.env.AUTH_STUB_ENABLED

    const mod = await import('./config.js')
    expect(mod.config.get('backendApi.sharedSecret')).toBe('')
  })

  test('non-production boot accepts empty Azure creds', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    delete process.env.ENTRA_CLIENT_ID
    delete process.env.ENTRA_CLIENT_SECRET
    delete process.env.SESSION_COOKIE_PASSWORD
    delete process.env.SESSION_COOKIE_SECURE
    delete process.env.AUTH_STUB_ENABLED

    const mod = await import('./config.js')
    expect(mod.config.get('isProduction')).toBe(false)
    expect(mod.config.get('auth.azureEntraId.clientId')).toBe('')
    expect(mod.config.get('auth.azureEntraId.clientSecret')).toBe('')
  })

  test('boot rejects a SESSION_COOKIE_PASSWORD shorter than 32 chars (any env)', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    process.env.SESSION_COOKIE_PASSWORD = 'a'.repeat(31)
    delete process.env.SESSION_COOKIE_SECURE
    delete process.env.AUTH_STUB_ENABLED

    await expect(import('./config.js')).rejects.toThrow(/32 characters/)
  })

  test('boot accepts a SESSION_COOKIE_PASSWORD of exactly 32 chars', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    const secret = 'a'.repeat(32)
    process.env.SESSION_COOKIE_PASSWORD = secret
    delete process.env.SESSION_COOKIE_SECURE
    delete process.env.AUTH_STUB_ENABLED

    const mod = await import('./config.js')
    expect(mod.config.get('session.cookie.password')).toBe(secret)
  })

  // Helper: a production env with all earlier-gated checks (cookie secret,
  // stub auth, Azure creds, shared secret) satisfied so we can isolate the
  // redis hardening assertions.
  function setProdEnvWithRedisDeps() {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'prod'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'false'
    process.env.ENTRA_CLIENT_ID = 'azure-client-id'
    process.env.ENTRA_CLIENT_SECRET = 'azure-client-secret'
    process.env.BACKEND_API_SHARED_SECRET = 'a-shared-secret'
    process.env.AUTH_CALLBACK_BASE_URL = 'https://app.example.com'
  }

  test('production boot rejects empty REDIS_PASSWORD', async () => {
    setProdEnvWithRedisDeps()
    process.env.REDIS_HOST = 'redis.example.internal'
    process.env.REDIS_USERNAME = 'redis-user'
    delete process.env.REDIS_PASSWORD

    await expect(import('./config.js')).rejects.toThrow(/REDIS_PASSWORD/)
  })

  test('production boot rejects REDIS_HOST=127.0.0.1', async () => {
    setProdEnvWithRedisDeps()
    process.env.REDIS_HOST = '127.0.0.1'
    process.env.REDIS_USERNAME = 'redis-user'
    process.env.REDIS_PASSWORD = 'redis-password'

    await expect(import('./config.js')).rejects.toThrow(/REDIS_HOST/)
  })

  test('production boot rejects REDIS_HOST=localhost', async () => {
    setProdEnvWithRedisDeps()
    process.env.REDIS_HOST = 'localhost'
    process.env.REDIS_USERNAME = 'redis-user'
    process.env.REDIS_PASSWORD = 'redis-password'

    await expect(import('./config.js')).rejects.toThrow(/REDIS_HOST/)
  })

  test('production boot rejects empty REDIS_USERNAME (would silently drop password)', async () => {
    setProdEnvWithRedisDeps()
    process.env.REDIS_HOST = 'redis.example.internal'
    delete process.env.REDIS_USERNAME
    process.env.REDIS_PASSWORD = 'redis-password'

    await expect(import('./config.js')).rejects.toThrow(/REDIS_USERNAME/)
  })

  test('non-production boot with defaults does not throw on redis config', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    delete process.env.SESSION_COOKIE_PASSWORD
    delete process.env.SESSION_COOKIE_SECURE
    delete process.env.AUTH_STUB_ENABLED
    delete process.env.REDIS_HOST
    delete process.env.REDIS_USERNAME
    delete process.env.REDIS_PASSWORD
    delete process.env.REDIS_TLS

    const mod = await import('./config.js')
    expect(mod.config.get('redis.host')).toBe('127.0.0.1')
    expect(mod.config.get('redis.username')).toBe('')
    expect(mod.config.get('redis.password')).toBe('')
    expect(mod.config.get('redis.useTLS')).toBe(false)
  })

  test('non-production boot with REDIS_TLS=true and empty password throws', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    delete process.env.SESSION_COOKIE_PASSWORD
    delete process.env.SESSION_COOKIE_SECURE
    delete process.env.AUTH_STUB_ENABLED
    process.env.REDIS_TLS = 'true'
    process.env.REDIS_HOST = 'redis.example.internal'
    process.env.REDIS_USERNAME = 'redis-user'
    delete process.env.REDIS_PASSWORD

    await expect(import('./config.js')).rejects.toThrow(/REDIS_PASSWORD/)
  })

  describe('RA-127 featureFlags.workItemCreationEnabled', () => {
    test('defaults to true', async () => {
      process.env.NODE_ENV = 'development'
      process.env.ENVIRONMENT = 'local'
      delete process.env.SESSION_COOKIE_PASSWORD
      delete process.env.SESSION_COOKIE_SECURE
      delete process.env.AUTH_STUB_ENABLED
      delete process.env.WORK_ITEM_CREATION_ENABLED

      const mod = await import('./config.js')
      expect(mod.config.get('featureFlags.workItemCreationEnabled')).toBe(true)
    })

    test('WORK_ITEM_CREATION_ENABLED=true enables the flag', async () => {
      process.env.NODE_ENV = 'development'
      process.env.ENVIRONMENT = 'local'
      delete process.env.SESSION_COOKIE_PASSWORD
      delete process.env.SESSION_COOKIE_SECURE
      delete process.env.AUTH_STUB_ENABLED
      process.env.WORK_ITEM_CREATION_ENABLED = 'true'

      const mod = await import('./config.js')
      expect(mod.config.get('featureFlags.workItemCreationEnabled')).toBe(true)
    })

    test('WORK_ITEM_CREATION_ENABLED=false keeps the flag off', async () => {
      process.env.NODE_ENV = 'development'
      process.env.ENVIRONMENT = 'local'
      delete process.env.SESSION_COOKIE_PASSWORD
      delete process.env.SESSION_COOKIE_SECURE
      delete process.env.AUTH_STUB_ENABLED
      process.env.WORK_ITEM_CREATION_ENABLED = 'false'

      const mod = await import('./config.js')
      expect(mod.config.get('featureFlags.workItemCreationEnabled')).toBe(false)
    })
  })
})

// RA-410. The re-accreditation decision call has its OWN timeout because
// management-be gates the atomic decision on an operator-journey push it
// retries up to 5 times (~28s worst case) before committing anything. fe
// must not abort before be finishes and returns its clean HTTP 500 — a
// premature abort re-opens the stranding bug. See
// `backendApi.decisionTimeoutMs` and `recordReAccreditationDecision`.
describe('config backend API decision timeout (RA-410)', () => {
  const originalEnv = process.env

  // be's worst-case OJ-push retry budget, in ms. The default decision
  // timeout MUST clear this with margin.
  const BE_WORST_CASE_RETRY_BUDGET_MS = 28000

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('defaults decisionTimeoutMs to 60000', async () => {
    delete process.env.BACKEND_API_DECISION_TIMEOUT_MS
    const mod = await import('./config.js')
    expect(mod.config.get('backendApi.decisionTimeoutMs')).toBe(60000)
  })

  test('default clears be worst-case retry budget with comfortable margin', async () => {
    delete process.env.BACKEND_API_DECISION_TIMEOUT_MS
    const mod = await import('./config.js')
    expect(mod.config.get('backendApi.decisionTimeoutMs')).toBeGreaterThan(
      BE_WORST_CASE_RETRY_BUDGET_MS
    )
  })

  test('default decision timeout is longer than the shared backend timeout', async () => {
    delete process.env.BACKEND_API_DECISION_TIMEOUT_MS
    delete process.env.BACKEND_API_TIMEOUT_MS
    const mod = await import('./config.js')
    expect(mod.config.get('backendApi.decisionTimeoutMs')).toBeGreaterThan(
      mod.config.get('backendApi.timeoutMs')
    )
  })

  test('BACKEND_API_DECISION_TIMEOUT_MS overrides the default', async () => {
    process.env.BACKEND_API_DECISION_TIMEOUT_MS = '90000'
    const mod = await import('./config.js')
    expect(mod.config.get('backendApi.decisionTimeoutMs')).toBe(90000)
  })
})

// RA-448 phase 2. The re-accreditation approve call also has its OWN
// timeout, for the same class of reason as decisionTimeoutMs above:
// management-be now resolves a real accreditation number from a second
// backend before committing anything, with a firm ~19s worst case
// (3 attempts x 5s + 2 x 2s capped backoff). fe must not abort before be
// finishes retrying — a premature abort re-opens the same stranding-bug
// class, and a caseworker retry can ask the backend to needlessly
// reapply/orphan a just-issued number. See `backendApi.approveTimeoutMs`
// and `approveReAccreditation`.
describe('config backend API approve timeout (RA-448 phase 2)', () => {
  const originalEnv = process.env

  // be's firm worst-case accreditation-number retry budget, in ms. The
  // default approve timeout MUST clear this with margin.
  const BE_WORST_CASE_RETRY_BUDGET_MS = 19000

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('defaults approveTimeoutMs to 25000', async () => {
    delete process.env.BACKEND_API_APPROVE_TIMEOUT_MS
    const mod = await import('./config.js')
    expect(mod.config.get('backendApi.approveTimeoutMs')).toBe(25000)
  })

  test('default clears be worst-case retry budget with comfortable margin', async () => {
    delete process.env.BACKEND_API_APPROVE_TIMEOUT_MS
    const mod = await import('./config.js')
    expect(mod.config.get('backendApi.approveTimeoutMs')).toBeGreaterThan(
      BE_WORST_CASE_RETRY_BUDGET_MS
    )
  })

  test('default approve timeout is longer than the shared backend timeout', async () => {
    delete process.env.BACKEND_API_APPROVE_TIMEOUT_MS
    delete process.env.BACKEND_API_TIMEOUT_MS
    const mod = await import('./config.js')
    expect(mod.config.get('backendApi.approveTimeoutMs')).toBeGreaterThan(
      mod.config.get('backendApi.timeoutMs')
    )
  })

  test('BACKEND_API_APPROVE_TIMEOUT_MS overrides the default', async () => {
    process.env.BACKEND_API_APPROVE_TIMEOUT_MS = '40000'
    const mod = await import('./config.js')
    expect(mod.config.get('backendApi.approveTimeoutMs')).toBe(40000)
  })
})
