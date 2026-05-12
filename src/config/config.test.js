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
    process.env.AZURE_CLIENT_ID = 'azure-client-id'
    process.env.AZURE_CLIENT_SECRET = 'azure-client-secret'
    process.env.REDIS_HOST = 'redis.example.internal'
    process.env.REDIS_USERNAME = 'redis-user'
    process.env.REDIS_PASSWORD = 'redis-password'

    const mod = await import('./config.js')
    expect(mod.config.get('isProduction')).toBe(true)
    expect(mod.config.get('auth.stubEnabled')).toBe(false)
    expect(mod.config.get('session.cookie.password')).toBe(REAL_SECRET)
  })

  test('production boot rejects empty AZURE_CLIENT_ID when stub auth disabled', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'prod'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'false'
    delete process.env.AZURE_CLIENT_ID
    process.env.AZURE_CLIENT_SECRET = 'azure-client-secret'

    await expect(import('./config.js')).rejects.toThrow(/AZURE_CLIENT_ID/)
  })

  test('production boot rejects empty AZURE_CLIENT_SECRET when stub auth disabled', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'prod'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'false'
    process.env.AZURE_CLIENT_ID = 'azure-client-id'
    delete process.env.AZURE_CLIENT_SECRET

    await expect(import('./config.js')).rejects.toThrow(/AZURE_CLIENT_SECRET/)
  })

  test('production boot does not surface Azure creds error when stub auth enabled (stub-in-prod check fires first)', async () => {
    // The existing hardening forbids stub auth in production, so this
    // combination always throws — what matters here is that it throws
    // for AUTH_STUB_ENABLED, NOT for the empty Azure creds. That proves
    // the Azure guard is correctly gated on `!stubEnabled`.
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'dev'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'true'
    delete process.env.AZURE_CLIENT_ID
    delete process.env.AZURE_CLIENT_SECRET

    const err = await import('./config.js').then(
      () => null,
      (e) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/AUTH_STUB_ENABLED/)
    expect(err.message).not.toMatch(/AZURE_CLIENT/)
  })

  test('non-production boot accepts empty Azure creds', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    delete process.env.AZURE_CLIENT_ID
    delete process.env.AZURE_CLIENT_SECRET
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

  // Helper: a production env with all earlier-gated checks (cookie
  // secret, stub auth, Azure creds) satisfied so we can isolate the
  // redis hardening assertions.
  function setProdEnvWithRedisDeps() {
    process.env.NODE_ENV = 'production'
    process.env.ENVIRONMENT = 'prod'
    process.env.SESSION_COOKIE_PASSWORD = REAL_SECRET
    process.env.AUTH_STUB_ENABLED = 'false'
    process.env.AZURE_CLIENT_ID = 'azure-client-id'
    process.env.AZURE_CLIENT_SECRET = 'azure-client-secret'
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
    test('defaults to false', async () => {
      process.env.NODE_ENV = 'development'
      process.env.ENVIRONMENT = 'local'
      delete process.env.SESSION_COOKIE_PASSWORD
      delete process.env.SESSION_COOKIE_SECURE
      delete process.env.AUTH_STUB_ENABLED
      delete process.env.WORK_ITEM_CREATION_ENABLED

      const mod = await import('./config.js')
      expect(mod.config.get('featureFlags.workItemCreationEnabled')).toBe(false)
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
