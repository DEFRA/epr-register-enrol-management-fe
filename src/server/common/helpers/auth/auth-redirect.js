import { randomUUID } from 'node:crypto'

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
 * the same session — see confirmPostLoginRedirect.
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
      request.yar.set(REDIRECT_SESSION_KEY, { target, nonce })
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
 * `fallback` when nothing was stashed, or when confirmPostLoginRedirect
 * already dropped it as stale.
 */
export function popPostLoginRedirect(request, fallback) {
  const stashed = request.yar.get(REDIRECT_SESSION_KEY)
  request.yar.clear(REDIRECT_SESSION_KEY)
  return stashed && isSafeRedirectTarget(stashed.target)
    ? stashed.target
    : fallback
}
