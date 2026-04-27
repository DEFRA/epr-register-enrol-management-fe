import { config } from '#/config/config.js'
import { getAzureEntraIdConfig } from '#/server/common/helpers/auth/providers/azure-entra-id.js'
import {
  ROLE_ASSIGN,
  ROLE_STANDARD
} from '#/server/common/helpers/auth/auth-scopes.js'

// --- Login — redirect to provider ---

export function regulatorLoginController(request, h) {
  const provider = getAzureEntraIdConfig(config)
  const state = crypto.randomUUID()
  request.yar.set('oauthState', state)

  const params = new URLSearchParams({
    client_id: provider.clientId,
    response_type: 'code',
    redirect_uri: provider.callbackUrl,
    scope: provider.scopes.join(' '),
    state
  })

  return h.redirect(`${provider.authUrl}?${params}`)
}

// --- Callback — exchange code for session ---

export async function regulatorCallbackController(request, h) {
  const { code, state } = request.query
  const storedState = request.yar.get('oauthState')

  if (!code || !state || state !== storedState) {
    return h.redirect('/auth/regulator/login')
  }

  request.yar.clear('oauthState')

  const provider = getAzureEntraIdConfig(config)

  const tokenResponse = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: provider.callbackUrl
    })
  })

  if (!tokenResponse.ok) {
    return h.redirect('/auth/regulator/login')
  }

  const { access_token: accessToken } = await tokenResponse.json()

  const profileResponse = await fetch(provider.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!profileResponse.ok) {
    return h.redirect('/auth/regulator/login')
  }

  const profile = await profileResponse.json()

  // Real role assignment will come from group claims / a directory lookup.
  // For PoC purposes every signed-in regulator gets the standard role.
  const user = {
    id: profile.id,
    email: profile.mail || profile.userPrincipalName,
    name: profile.displayName,
    roles: [ROLE_STANDARD]
  }

  request.yar.set('user', user)
  return h.redirect('/')
}

// --- Logout ---

export function logoutController(request, h) {
  request.yar.clear('user')
  return h.redirect('/auth/regulator/login')
}

// Re-exported for test / route convenience
export const ROLES = { ROLE_STANDARD, ROLE_ASSIGN }
