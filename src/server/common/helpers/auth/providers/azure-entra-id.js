// Returns OAuth2 endpoint config for Azure Entra ID (Defra regulator users).
// ENTRA_TENANT_ID is set to the appropriate tenant by the deployment pipeline.
export function getAzureEntraIdConfig(config) {
  const tenantId = config.get('auth.azureEntraId.tenantId')
  const callbackUrl = `${config.get('auth.callbackBaseUrl')}/auth/regulator/callback`
  return {
    authUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    scopes: ['openid', 'profile', 'email'],
    clientId: config.get('auth.azureEntraId.clientId'),
    clientSecret: config.get('auth.azureEntraId.clientSecret'),
    callbackUrl
  }
}
