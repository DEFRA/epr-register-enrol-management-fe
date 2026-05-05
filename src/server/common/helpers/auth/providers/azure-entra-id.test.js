import { getAzureEntraIdConfig } from './azure-entra-id.js'

describe('getAzureEntraIdConfig', () => {
  test('builds endpoints from tenant id and callback base url', () => {
    const lookup = {
      'auth.azureEntraId.tenantId': 'tenant-123',
      'auth.azureEntraId.clientId': 'client-abc',
      'auth.azureEntraId.clientSecret': 'secret',
      'auth.callbackBaseUrl': 'https://app.example.com'
    }
    const config = { get: (key) => lookup[key] }

    const result = getAzureEntraIdConfig(config)

    expect(result).toEqual({
      authUrl:
        'https://login.microsoftonline.com/tenant-123/oauth2/v2.0/authorize',
      tokenUrl:
        'https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token',
      jwksUri:
        'https://login.microsoftonline.com/tenant-123/discovery/v2.0/keys',
      issuer: 'https://login.microsoftonline.com/tenant-123/v2.0',
      scopes: ['openid', 'profile', 'email'],
      clientId: 'client-abc',
      clientSecret: 'secret',
      callbackUrl: 'https://app.example.com/auth/regulator/callback'
    })
  })
})
