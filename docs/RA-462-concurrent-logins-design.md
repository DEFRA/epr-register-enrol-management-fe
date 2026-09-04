# RA-462 — Concurrent logins: implementation design (caseworker app)

**Status:** Design only — not implemented. Policy chosen by product on
2026-09-02: **allow concurrent sessions, notify the user with a dismissible
toast** (no forced sign-out). Primary ADR + full design:
`epr-register-enrol-frontend/docs/adr/0001-single-active-session-per-user.md`
and `epr-register-enrol-frontend/docs/RA-462-concurrent-logins-design.md`.
**Branch:** `feature/RA-462-ConcurrentLogins`

This app has the same weakness; this doc records only the deltas.

---

## 1. Problem in this app

`src/server/routes/auth/controller.js` → `regulatorCallback` and
`src/server/routes/auth/stub/controller.js` → `stubLoginPostController` call
`request.yar.reset()` before `request.yar.set('user', user)`. `reset()` only
touches the current request's session, so concurrent caseworker sessions are
possible and the user is never told a second sign-in occurred.

### Differences from the frontend that matter

1. **No per-request session hook exists.** The `yar-session` scheme is defined
   _inline and duplicated_ in `auth-plugin.js` and `stub-auth-plugin.js` (dev
   branch); each only does `request.yar.get('user')`. There is nowhere central
   to compute the notice. Add an **`onPostAuth`** server extension (registered
   by both plugins, dev + real branches; the `NODE_ENV=test` `test-bypass`
   scheme excluded) — same approach the frontend design uses. Extracting a
   shared `yarSessionAuthenticate` is still worthwhile for other reasons but is
   **not** required for RA-462 if the `onPostAuth` route is taken.

2. **yar is not pinned server-side.** `src/server/plugins/session-cache.js` does
   not set `maxCookieSize: 0`. `loginAt`, `concurrentLoginInfo` and
   `noticeDismissedFor` are all small, so they ride in the cookie fine — but for
   consistency with the frontend and to keep session-storage semantics
   predictable, add `maxCookieSize: 0` as a small separate commit on this
   branch. Not a blocker for the feature.

3. **Single provider.** Only `regulatorCallback` + stub login — two write sites,
   not three. `user.id` = `claims.oid ?? claims.sub` (real) / `stub-support-user`
   / `STUB_USERS[0].id` (stub).

4. **`logout` is currently synchronous** and reads only `idToken`. Add a `user`
   read and `await clear(registry, user.id)` before the first `yar.reset()`;
   make the handler `async` (no behavioural change).

5. **`stubLoginPostController` is synchronous.** Either make it `async` for the
   `recordLogin` call or fire-and-forget it (dev/stub only — acceptable).

## 2. Design (deltas)

Identical shape to the frontend design:

- **Session stamp** `request.yar.set('loginAt', Date.now())` at both login
  completions.
- **Registry** `src/server/common/helpers/auth/active-session-registry.js`
  (+ `.test.js`) — catbox segment `active-sessions` on the existing `session`
  cache via `server.cache({ segment, expiresIn: config.get('session.cache.ttl') })`,
  exposed on `server.app.activeSessionRegistry` from a small plugin registered
  after `sessionCache` in `src/server/server.js`. Entry
  `{ lastLoginAt, lastLoginSessionId }` keyed by `userId`. `recordLogin` returns
  the previous entry; `getLatest`; `clear`. Best-effort throughout.
- **On login**: after reset + set-user + stamp, `recordLogin(...)`; if a
  differing prior entry existed, `request.yar.set('concurrentLoginInfo', { otherLoginAt })`.
- **`onPostAuth`** `src/server/common/helpers/auth/concurrent-login-notice.js`
  (+ `.test.js`): compute `request.app.concurrentLoginNotice` =
  `{ variant: 'alert' | 'info', otherLoginAt }` using the same comparison
  (`lastLoginAt > session loginAt`, different `sessionId`, `> noticeDismissedFor`).
  No `yar.reset()`, no `unauthenticated`.
- **Render**: caseworker views get context from
  `src/config/nunjucks/context/context.js` (confirm the exact file — this app's
  nunjucks context builder) — add `concurrentLoginNotice`. New component under
  `src/server/common/components/session-notice/` included in this app's base
  layout. Server-side markup = GOV.UK notification banner with a no-JS "Hide"
  form post; PE script lifts it into a toast (`role="alert"` / `role="status"`,
  `aria-live`, focusable close, Escape). Copy: this app's `translation.json`
  (caseworker service has no Welsh requirement — confirm; if en-only, one
  locale file).
- **Dismissal route** `POST /auth/session-notice/dismiss` under
  `src/server/routes/auth/session-notice/` — auth + crumb; sets
  `noticeDismissedFor` (recomputed server-side), clears `concurrentLoginInfo`,
  redirects back (no-JS) or 204 (fetch).
- **Config** `SESSION_CONCURRENT_LOGIN_NOTICE_ENABLED` (default `true`) in
  `src/config/config.js`.

Alert copy points at this app's logout (`/auth/logout` → RA-449 logged-out
interstitial). "If this was not you, sign out and contact your administrator."

## 3. Files to change

| File                                                                        | Change                                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/server/common/helpers/auth/active-session-registry.js` (+ `.test.js`)  | **New.** Registry helper.                                                                          |
| `src/server/common/helpers/auth/concurrent-login-notice.js` (+ `.test.js`)  | **New.** `onPostAuth` handler.                                                                     |
| `src/server/common/helpers/auth/auth-plugin.js`                             | Register the `onPostAuth` extension.                                                               |
| `src/server/common/helpers/auth/stub-auth-plugin.js`                        | Register it in the dev (non-test) branch.                                                          |
| `src/server/common/helpers/auth/auth-plugin.test.js`                        | Cover current/superseded/dismissed/store-error.                                                    |
| `src/server/routes/auth/controller.js`                                      | `loginAt` stamp + `recordLogin` + Info flag in `regulatorCallback`; `clear` + `async` in `logout`. |
| `src/server/routes/auth/controller.test.js`                                 | Assert stamp/write after reset; Info only with a prior entry; registry cleared on logout.          |
| `src/server/routes/auth/stub/controller.js`                                 | Same stamp + `recordLogin` + Info flag; `async` or fire-and-forget.                                |
| `src/server/routes/auth/stub/controller.test.js` (or equivalent)            | Assert registry write on stub login.                                                               |
| `src/server/routes/auth/session-notice/index.js` + `controller.js` (+ test) | **New.** Dismissal route.                                                                          |
| `src/server/plugins/session-cache.js`                                       | _Recommended, separate commit:_ add `maxCookieSize: 0`.                                            |
| `src/server/server.js` / small plugin                                       | `server.cache({ segment: 'active-sessions', ... })` → `server.app.activeSessionRegistry`.          |
| `src/config/nunjucks/context/context.js` (+ test)                           | Surface `concurrentLoginNotice`.                                                                   |
| `src/server/common/components/session-notice/template.njk` + `.scss`        | **New.** Banner markup.                                                                            |
| base layout `.njk`                                                          | Include the component when `concurrentLoginNotice`.                                                |
| client JS + SCSS (this app's `src/client/...`)                              | **New.** Toast PE + styles.                                                                        |
| `translation.json` (+ `cy` if required)                                     | Toast copy.                                                                                        |
| `src/config/config.js`                                                      | `SESSION_CONCURRENT_LOGIN_NOTICE_ENABLED`.                                                         |
| `docs/authentication.md`                                                    | New section.                                                                                       |

## 4. Test plan (unit / integration — this repo)

1. Login as caseworker → cookie C1; login again same identity → C2. Protected
   page with C1 → **200 with the alert banner**; with C2 → 200, no alert.
2. C2's first render shows the info banner; C1's first login showed none.
3. `POST /auth/session-notice/dismiss` with C1 → banner gone on subsequent C1
   requests until a third login re-raises it.
4. C1 can still perform protected actions after C2 logs in — no 302-to-login.
5. Fail-open: registry `get` throws → C1 still 200, no banner.
6. Kill switch off → no banner; `recordLogin` still writes.
7. Support-user login path behaves the same.
8. `route-scope-coverage` + RA-299 work-items filter tests still pass; if
   `maxCookieSize: 0` added, session/`yar` tests still pass.
9. `NODE_ENV=test` bypass suite stays green.

## 5. Manual verification (EXT-TEST / management)

1. Same caseworker (real Entra ID) in Browser A then Browser B → B shows the
   info toast, A shows the alert toast with B's sign-in time. Both stay usable.
2. Dismiss in A; third login (Browser C) re-raises the alert in A and B.
3. JavaScript disabled → in-flow banner with a working "Hide" form post.
4. RA-299 work-items filter behaviour and RA-306 sign-out unchanged.
5. Screen-reader pass on both toast variants.

## 6. Out of scope

Real "sign out all other sessions" action (kept in reserve — needs a per-user
`sessionsValidFrom` stamp); device/location list; notify-channel alerting;
`epr-register-enrol-management-be` (stateless).
