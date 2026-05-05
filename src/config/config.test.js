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

    const mod = await import('./config.js')
    expect(mod.config.get('isProduction')).toBe(true)
    expect(mod.config.get('auth.stubEnabled')).toBe(false)
    expect(mod.config.get('session.cookie.password')).toBe(REAL_SECRET)
  })
})
