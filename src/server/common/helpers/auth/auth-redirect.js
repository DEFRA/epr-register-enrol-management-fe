import { randomUUID } from 'node:crypto'

import {
  ROLE_STANDARD,
  ROLE_SUPPORT_READONLY
} from '#/server/common/helpers/auth/auth-scopes.js'

const REDIRECT_SESSION_KEY = 'postLoginRedirect'

// Only ever hand back a same-site path — an absolute or protocol-relative
// value in the session would turn login into an open redirect.
function isSafeRedirectTarget(target) {
  return (
    typeof target === 'string' &&
    target.startsWith('/') &&
    !target.startsWith('//') &&
    !target.startsWith('/\\')
  )
}

// RA-335: a session holds exactly one of ROLE_STANDARD / ROLE_SUPPORT_READONLY,
// never both (see auth-scopes.js), and both families guard GET routes
// (e.g. GET /work-items/{id}/assign requires standard, GET /backend-status
// requires support-readonly). A target captured on a role-scoped GET must
// only be replayed after a login that actually holds that role — otherwise
// a signed-out visitor to one of those routes who then signs in as the
// *other* role gets sent straight to a 403 instead of '/work-items'.
// Routes with no scope requirement (any authenticated session) return null
// here, and their stash is valid after either role logs in.
function requiredRoleFor(request) {
  const requiredScope =
    request.route?.settings?.auth?.access?.[0]?.scope?.selection ?? []
  if (requiredScope.includes(ROLE_SUPPORT_READONLY)) {
    return ROLE_SUPPORT_READONLY
  }
  if (requiredScope.includes(ROLE_STANDARD)) {
    return ROLE_STANDARD
  }
  return null
}

/**
 * onPreResponse extension that redirects unauthenticated requests to the
 * regulator login page before the generic error handler runs.
 *
 * 403 (insufficient role) is intentionally not redirected — the user is
 * already authenticated and should see an access-denied error instead.
 *
 * The originally requested GET URL is stashed in the session, alongside a
 * one-time nonce carried in the login redirect's query string, so the login
 * completion handlers can send the user back to it (RA-403) rather than
 * always landing on '/work-items'. The nonce is what stops a stash from a
 * since-abandoned login attempt leaking into a *later, unrelated* login in
 * the same session — see confirmPostLoginRedirect. The route's required
 * role is stashed too, so popPostLoginRedirect can refuse to replay it
 * against a login that ends up with the wrong role.
 */
export function redirectToLogin(request, h) {
  const { response } = request

  if (!response.isBoom || response.output.statusCode !== 401) {
    return h.continue
  }

  let query = ''

  if (request.method === 'get' && request.yar) {
    const target = request.path + (request.url?.search ?? '')
    if (isSafeRedirectTarget(target) && !target.startsWith('/auth/')) {
      const nonce = randomUUID()
      const role = requiredRoleFor(request)
      request.yar.set(REDIRECT_SESSION_KEY, { target, nonce, role })
      query = `?rt=${encodeURIComponent(nonce)}`
    }
  }

  return h.redirect(`/auth/regulator/login${query}`)
}

/**
 * Called by every login entry-point GET handler (the stub chooser page, the
 * real Entra ID initiator) before it renders or redirects. A stash is only
 * kept if this request carries the nonce that redirectToLogin minted for
 * it — i.e. this is a continuation of the specific redirect chain that
 * created the stash, not a direct visit, a bookmark, or a stale tab
 * completing an unrelated login later in the same session. Any mismatch
 * drops the stash rather than letting it be replayed against this login.
 */
export function confirmPostLoginRedirect(request) {
  const stashed = request.yar.get(REDIRECT_SESSION_KEY)
  if (stashed && stashed.nonce !== request.query.rt) {
    request.yar.clear(REDIRECT_SESSION_KEY)
  }
}

/**
 * Reads and clears the URL stashed by redirectToLogin, for use by login
 * completion handlers once a session has been established. Falls back to
 * `fallback` when nothing was stashed, when confirmPostLoginRedirect
 * already dropped it as stale, or when the stash was captured on a route
 * that requires a different role than the one this login just established.
 */
export function popPostLoginRedirect(request, role, fallback) {
  const stashed = request.yar.get(REDIRECT_SESSION_KEY)
  request.yar.clear(REDIRECT_SESSION_KEY)
  if (!stashed || !isSafeRedirectTarget(stashed.target)) {
    return fallback
  }
  if (stashed.role && stashed.role !== role) {
    return fallback
  }
  return stashed.target
}
