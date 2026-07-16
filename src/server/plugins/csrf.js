import crumb from '@hapi/crumb'

import { config } from '#/config/config.js'

/**
 * Cross-site request forgery (CSRF) protection.
 *
 * The BFF authenticates the session with a same-origin cookie. Without
 * a per-session token check, any HTML form on a third-party origin
 * could submit a `POST` to one of our state-changing endpoints (task
 * status, action, assignment, stub login) with the user's
 * cookie attached and succeed. `@hapi/crumb` issues a short-lived,
 * cryptographically random token bound to the session via a separate
 * cookie and validated against a hidden form field on every POST.
 *
 * Configuration rationale:
 *
 * - `restful: false` — we use plain `<form method="post">` with a
 *   hidden `crumb` field rather than custom XHR with a header. Vision's
 *   `addToViewContext: true` (default) injects `crumb` into the view
 *   context so templates render `<input type="hidden" name="crumb" …>`
 *   automatically.
 * - `cookieOptions.isSecure` mirrors the session cookie's secure flag
 *   so dev (HTTP loopback) still works while deployed envs require
 *   HTTPS.
 * - `cookieOptions.isSameSite: 'Lax'` keeps the crumb cookie attached
 *   on top-level navigations (so the form GET that issued the crumb
 *   matches the subsequent POST) but blocks cross-site requests from
 *   carrying it.
 * - `skip` excludes the OAuth callback (a redirect arriving from the
 *   IdP — it cannot carry our same-origin crumb) and the public
 *   `/health` probe (it never POSTs and we do not want platform
 *   liveness checks to receive a `Set-Cookie`). Every other POST in
 *   the app is a same-origin browser submission and must validate.
 */
export const csrfProtection = {
  plugin: crumb,
  options: {
    key: 'crumb',
    restful: false,
    autoGenerate: true,
    addToViewContext: true,
    cookieOptions: {
      isSecure: config.get('session.cookie.secure'),
      isHttpOnly: true,
      isSameSite: 'Lax',
      path: '/'
    },
    skip(request) {
      const path = request.path
      return path === '/auth/regulator/callback' || path === '/health'
    }
  }
}
