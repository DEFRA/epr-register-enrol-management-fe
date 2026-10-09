import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  _clearEntraEndpointCache,
  getAzureEntraIdConfig,
  getAzureEntraIdEndpoints,
  getEntraDiscoveryUrl,
  isEntraIdConfigured,
  resolveAzureEntraIdProvider
} from './azure-entra-id.js'

function makeConfig(overrides = {}) {
  const lookup = {
    'auth.azureEntraId.discoveryUrl': '',
    'auth.azureEntraId.tenantId': '',
    'auth.azureEntraId.clientId': 'client-abc',
    'auth.azureEntraId.clientSecret': 'secret',
    'auth.callbackBaseUrl': 'https://app.example.com',
    ...overrides
  }
  return { get: (key) => lookup[key] }
}

// Shape of the Entra ID stub's document: issuer and browser-facing
// endpoints on the external URL, server-to-server ones on the internal URL.
const STUB_DISCOVERY_URL =
  'http://entra-stub:3200/.well-known/openid-configuration'
const stubDoc = {
  issuer: 'http://localhost:3200',
  authorization_endpoint: 'http://localhost:3200/authorize',
  token_endpoint: 'http://entra-stub:3200/token',
  jwks_uri: 'http://entra-stub:3200/.well-known/jwks.json',
  end_session_endpoint: 'http://localhost:3200/logout'
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

afterEach(() => {
  _clearEntraEndpointCache()
})

describe('getEntraDiscoveryUrl', () => {
  test('uses ENTRA_DISCOVERY_URL when set, ignoring the tenant', () => {
    const config = makeConfig({
      'auth.azureEntraId.discoveryUrl': STUB_DISCOVERY_URL,
      'auth.azureEntraId.tenantId': 'tenant-123'
    })

    expect(getEntraDiscoveryUrl(config)).toBe(STUB_DISCOVERY_URL)
  })

  test('defaults to the Microsoft v2.0 document for the tenant', () => {
    const config = makeConfig({ 'auth.azureEntraId.tenantId': 'tenant-123' })

    expect(getEntraDiscoveryUrl(config)).toBe(
      'https://login.microsoftonline.com/tenant-123/v2.0/.well-known/openid-configuration'
    )
  })

  test('is blank when neither discovery URL nor tenant is set', () => {
    expect(getEntraDiscoveryUrl(makeConfig())).toBe('')
  })
})

describe('isEntraIdConfigured', () => {
  test.each([
    [
      'client id + discovery URL',
      { 'auth.azureEntraId.discoveryUrl': STUB_DISCOVERY_URL },
      true
    ],
    [
      'client id + tenant',
      { 'auth.azureEntraId.tenantId': 'tenant-123' },
      true
    ],
    ['client id only', {}, false],
    [
      'discovery URL but no client id',
      {
        'auth.azureEntraId.discoveryUrl': STUB_DISCOVERY_URL,
        'auth.azureEntraId.clientId': ''
      },
      false
    ]
  ])('%s -> %s', (_label, overrides, expected) => {
    expect(isEntraIdConfigured(makeConfig(overrides))).toBe(expected)
  })
})

describe('getAzureEntraIdConfig', () => {
  test('returns client config and the discovery URL', () => {
    const config = makeConfig({ 'auth.azureEntraId.tenantId': 'tenant-123' })

    expect(getAzureEntraIdConfig(config)).toEqual({
      discoveryUrl:
        'https://login.microsoftonline.com/tenant-123/v2.0/.well-known/openid-configuration',
      scopes: ['openid', 'profile', 'email'],
      clientId: 'client-abc',
      clientSecret: 'secret',
      callbackUrl: 'https://app.example.com/auth/regulator/callback'
    })
  })
})

describe('getAzureEntraIdEndpoints', () => {
  test('maps the discovery document to provider endpoints', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(stubDoc))

    const endpoints = await getAzureEntraIdEndpoints(STUB_DISCOVERY_URL, {
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      STUB_DISCOVERY_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(endpoints).toEqual({
      authUrl: stubDoc.authorization_endpoint,
      tokenUrl: stubDoc.token_endpoint,
      jwksUri: stubDoc.jwks_uri,
      issuer: stubDoc.issuer,
      logoutUrl: stubDoc.end_session_endpoint
    })
  })

  test('takes the issuer from the document, not from the URL it was fetched from', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(stubDoc))

    const { issuer } = await getAzureEntraIdEndpoints(STUB_DISCOVERY_URL, {
      fetchImpl
    })

    expect(issuer).toBe('http://localhost:3200')
    expect(STUB_DISCOVERY_URL.startsWith(issuer)).toBe(false)
  })

  test('caches the endpoints per discovery URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(stubDoc))

    await getAzureEntraIdEndpoints(STUB_DISCOVERY_URL, { fetchImpl })
    await getAzureEntraIdEndpoints(STUB_DISCOVERY_URL, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('rejects on a non-2xx response and does not cache the failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }))
      .mockResolvedValueOnce(jsonResponse(stubDoc))

    await expect(
      getAzureEntraIdEndpoints(STUB_DISCOVERY_URL, { fetchImpl })
    ).rejects.toThrow(/discovery failed: 503/)
    await expect(
      getAzureEntraIdEndpoints(STUB_DISCOVERY_URL, { fetchImpl })
    ).resolves.toMatchObject({ issuer: stubDoc.issuer })
  })

  test('rejects when the fetch itself fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })

    await expect(
      getAzureEntraIdEndpoints(STUB_DISCOVERY_URL, { fetchImpl })
    ).rejects.toThrow('fetch failed')
  })

  test('rejects when the document lacks a required endpoint', async () => {
    const { end_session_endpoint: _omit, ...partial } = stubDoc
    const fetchImpl = vi.fn(async () => jsonResponse(partial))

    await expect(
      getAzureEntraIdEndpoints(STUB_DISCOVERY_URL, { fetchImpl })
    ).rejects.toThrow(/missing: end_session_endpoint/)
  })

  test('rejects without fetching when no discovery URL is configured', async () => {
    const fetchImpl = vi.fn()

    await expect(getAzureEntraIdEndpoints('', { fetchImpl })).rejects.toThrow(
      /not configured/
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('resolveAzureEntraIdProvider', () => {
  test('merges client config with the discovered endpoints', async () => {
    const config = makeConfig({
      'auth.azureEntraId.discoveryUrl': STUB_DISCOVERY_URL
    })
    const fetchImpl = vi.fn(async () => jsonResponse(stubDoc))

    const provider = await resolveAzureEntraIdProvider(config, { fetchImpl })

    expect(provider).toMatchObject({
      clientId: 'client-abc',
      clientSecret: 'secret',
      callbackUrl: 'https://app.example.com/auth/regulator/callback',
      authUrl: stubDoc.authorization_endpoint,
      tokenUrl: stubDoc.token_endpoint,
      jwksUri: stubDoc.jwks_uri,
      issuer: stubDoc.issuer,
      logoutUrl: stubDoc.end_session_endpoint
    })
  })

  test('fetches the Microsoft document for the tenant by default', async () => {
    const config = makeConfig({ 'auth.azureEntraId.tenantId': 'tenant-123' })
    const fetchImpl = vi.fn(async () => jsonResponse(stubDoc))

    await resolveAzureEntraIdProvider(config, { fetchImpl })

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://login.microsoftonline.com/tenant-123/v2.0/.well-known/openid-configuration'
    )
  })
})
