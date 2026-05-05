/**
 * Helpers for exercising CSRF-protected POST routes from `server.inject`.
 *
 * `@hapi/crumb` (configured in `src/server/plugins/csrf.js`) issues a
 * cookie-bound token on safe requests and validates it against a
 * `crumb` field on the body. Tests must do the equivalent of a
 * browser's "GET the form, then POST it back" round trip.
 */

/**
 * Fetch a fresh crumb token by hitting an authenticated GET route.
 *
 * Uses `/` (the home page) because the CSRF plugin's `skip` filter
 * excludes the public `/health` probe — we want the cookie to be set.
 */
export async function getCrumbToken(server, { url = '/' } = {}) {
  const res = await server.inject({ method: 'GET', url })
  const setCookie = [].concat(res.headers['set-cookie'] ?? [])
  for (const header of setCookie) {
    const match = /(?:^|;\s*)crumb=([^;]+)/.exec(header)
    if (match) {
      return decodeURIComponent(match[1])
    }
  }
  throw new Error(
    `No crumb cookie was set on GET ${url}; status=${res.statusCode}`
  )
}

/**
 * Inject a request with a freshly-minted crumb attached as both the
 * cookie and the appropriate body field. Supports object payloads
 * (merged into a JSON-style payload that Hapi's parser accepts) and
 * `application/x-www-form-urlencoded` string payloads.
 */
export async function injectWithCrumb(server, opts) {
  const crumb = await getCrumbToken(server)
  let payload = opts.payload
  if (typeof payload === 'string') {
    const encoded = `crumb=${encodeURIComponent(crumb)}`
    payload =
      payload === '' || payload === undefined
        ? encoded
        : `${payload}&${encoded}`
  } else {
    payload = { ...(payload || {}), crumb }
  }
  const headers = {
    ...(opts.headers || {}),
    cookie: [opts.headers?.cookie, `crumb=${crumb}`].filter(Boolean).join('; ')
  }
  return server.inject({ ...opts, payload, headers })
}
