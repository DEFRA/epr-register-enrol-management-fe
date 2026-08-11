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
 * The originally requested GET URL is stashed in the session so the login
 * completion handlers can send the user back to it (RA-403) rather than
 * always landing on '/work-items'.
 */
export function redirectToLogin(request, h) {
  const { response } = request

  if (!response.isBoom || response.output.statusCode !== 401) {
    return h.continue
  }

  if (request.method === 'get' && request.yar) {
    const target = request.path + (request.url?.search ?? '')
    if (isSafeRedirectTarget(target) && !target.startsWith('/auth/')) {
      request.yar.set(REDIRECT_SESSION_KEY, target)
    }
  }

  return h.redirect('/auth/regulator/login')
}

/**
 * Reads and clears the URL stashed by redirectToLogin, for use by login
 * completion handlers once a session has been established. Falls back to
 * `fallback` when nothing was stashed (e.g. the user navigated to a login
 * page directly rather than being bounced there from a protected page).
 */
export function popPostLoginRedirect(request, fallback) {
  const target = request.yar.get(REDIRECT_SESSION_KEY)
  request.yar.clear(REDIRECT_SESSION_KEY)
  return isSafeRedirectTarget(target) ? target : fallback
}
