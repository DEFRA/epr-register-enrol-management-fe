/**
 * RA-306 (AC03). onPreResponse extension that marks every authenticated
 * response as uncacheable.
 *
 * Without this, a browser will happily re-render a previously visited case
 * management page from its back/forward cache after the user has signed
 * out — the page content is still on disk, so no request reaches us and
 * the auth scheme never gets a chance to bounce the user to sign-in.
 * `no-store` forces the browser to refetch on back-navigation, at which
 * point the destroyed session yields a 401 that `redirectToLogin` turns
 * into a redirect to the sign-in page.
 *
 * Scope is deliberately "authenticated responses only", keyed off
 * `request.auth.isAuthenticated` rather than a path pattern:
 *
 * - Static assets (`/public/**`, `/favicon.ico`) opt out of auth with
 *   `auth: false`, so they keep the long-lived, content-hashed caching
 *   configured in `serve-static-files.js`. They carry no user data.
 * - The sign-in pages are likewise `auth: false` and stay cacheable.
 *
 * Registered in `server.js` AFTER `catchAll` so that error pages rendered
 * for a signed-in user are covered too — hapi's onPreResponse chain keeps
 * running after an extension swaps the response, so by the time this runs
 * `request.response` is the final one.
 *
 * `Pragma`/`Expires` are legacy HTTP/1.0 belt-and-braces; harmless for
 * modern browsers and expected by some intermediary proxies.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 */
export function noStoreAuthenticatedResponses(request, h) {
  if (!request.auth?.isAuthenticated) {
    return h.continue
  }

  const { response } = request

  if (response?.isBoom) {
    // A Boom error that no extension converted into a view: its headers
    // live on `output.headers`, not on a `.header()` setter.
    response.output.headers['cache-control'] = 'no-store'
    response.output.headers.pragma = 'no-cache'
    response.output.headers.expires = '0'
    return h.continue
  }

  if (typeof response?.header === 'function') {
    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')
    response.header('expires', '0')
  }

  return h.continue
}
