/**
 * onPreResponse extension that redirects unauthenticated requests to the
 * regulator login page before the generic error handler runs.
 *
 * 403 (insufficient role) is intentionally not redirected — the user is
 * already authenticated and should see an access-denied error instead.
 */
export function redirectToLogin(request, h) {
  const { response } = request

  if (!response.isBoom || response.output.statusCode !== 401) {
    return h.continue
  }

  return h.redirect('/auth/regulator/login')
}
