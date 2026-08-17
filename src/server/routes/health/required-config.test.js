import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// findMissingRequiredConfig reads the live config singleton, and config.js
// throws at import time for some invalid states, so each scenario gets a
// fresh process.env and a fresh dynamic import — same convention as
// src/config/config.test.js.
describe('#findMissingRequiredConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  async function importFindMissing() {
    const mod = await import('./required-config.js')
    return mod.findMissingRequiredConfig
  }

  test('reports nothing missing on default local config', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    delete process.env.BACKEND_API_URL
    delete process.env.ENTRA_TENANT_ID
    delete process.env.AUTH_BASIC_ENABLED

    const findMissingRequiredConfig = await importFindMissing()

    expect(findMissingRequiredConfig()).toEqual([])
  })

  test('flags BACKEND_API_URL when still the localhost default outside local', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'ext-test'
    process.env.SESSION_COOKIE_PASSWORD = 'a'.repeat(48)
    process.env.AUTH_STUB_ENABLED = 'true'
    process.env.BACKEND_API_SHARED_SECRET = 'a-secret'
    process.env.AUTH_CALLBACK_BASE_URL = 'https://example.test'
    delete process.env.BACKEND_API_URL

    const findMissingRequiredConfig = await importFindMissing()

    expect(findMissingRequiredConfig()).toContain('BACKEND_API_URL')
  })

  test('does not flag BACKEND_API_URL when set outside local', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'ext-test'
    process.env.SESSION_COOKIE_PASSWORD = 'a'.repeat(48)
    process.env.AUTH_STUB_ENABLED = 'true'
    process.env.BACKEND_API_SHARED_SECRET = 'a-secret'
    process.env.AUTH_CALLBACK_BASE_URL = 'https://example.test'
    process.env.BACKEND_API_URL = 'https://backend.ext-test.example'

    const findMissingRequiredConfig = await importFindMissing()

    expect(findMissingRequiredConfig()).not.toContain('BACKEND_API_URL')
  })

  test('does not flag BACKEND_API_URL when environment is local, even with the default', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    delete process.env.BACKEND_API_URL

    const findMissingRequiredConfig = await importFindMissing()

    expect(findMissingRequiredConfig()).not.toContain('BACKEND_API_URL')
  })

  test('flags ENTRA_TENANT_ID when stub auth is disabled and tenant id is blank', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    process.env.AUTH_STUB_ENABLED = 'false'
    delete process.env.ENTRA_TENANT_ID

    const findMissingRequiredConfig = await importFindMissing()

    expect(findMissingRequiredConfig()).toContain('ENTRA_TENANT_ID')
  })

  test('does not flag ENTRA_TENANT_ID when stub auth is enabled', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    process.env.AUTH_STUB_ENABLED = 'true'
    delete process.env.ENTRA_TENANT_ID

    const findMissingRequiredConfig = await importFindMissing()

    expect(findMissingRequiredConfig()).not.toContain('ENTRA_TENANT_ID')
  })

  test('does not flag ENTRA_TENANT_ID when stub auth is disabled but a tenant id is set', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    process.env.AUTH_STUB_ENABLED = 'false'
    process.env.ENTRA_TENANT_ID = 'a-tenant-id'

    const findMissingRequiredConfig = await importFindMissing()

    expect(findMissingRequiredConfig()).not.toContain('ENTRA_TENANT_ID')
  })

  test('flags BASIC_USER and BASIC_PASSWD when basic auth is enabled and both are blank', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    process.env.AUTH_BASIC_ENABLED = 'true'
    delete process.env.BASIC_USER
    delete process.env.BASIC_PASSWD

    const findMissingRequiredConfig = await importFindMissing()
    const missing = findMissingRequiredConfig()

    expect(missing).toContain('BASIC_USER')
    expect(missing).toContain('BASIC_PASSWD')
  })

  test('does not flag BASIC_USER/BASIC_PASSWD when basic auth is disabled', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    process.env.AUTH_BASIC_ENABLED = 'false'
    delete process.env.BASIC_USER
    delete process.env.BASIC_PASSWD

    const findMissingRequiredConfig = await importFindMissing()
    const missing = findMissingRequiredConfig()

    expect(missing).not.toContain('BASIC_USER')
    expect(missing).not.toContain('BASIC_PASSWD')
  })

  test('does not flag BASIC_USER/BASIC_PASSWD when basic auth is enabled and both are set', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENVIRONMENT = 'local'
    process.env.AUTH_BASIC_ENABLED = 'true'
    process.env.BASIC_USER = 'a-user'
    process.env.BASIC_PASSWD = 'a-password'

    const findMissingRequiredConfig = await importFindMissing()
    const missing = findMissingRequiredConfig()

    expect(missing).not.toContain('BASIC_USER')
    expect(missing).not.toContain('BASIC_PASSWD')
  })
})
