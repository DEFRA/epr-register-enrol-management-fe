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
})
