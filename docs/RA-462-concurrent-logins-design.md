# RA-462 — Concurrent logins: implementation design (caseworker app)

**Status:** Design only — enforcement NOT implemented pending product/security
sign-off on the single-active-session policy.
**Branch:** `feature/RA-462-ConcurrentLogins`
**Primary ADR:** `epr-register-enrol-frontend/docs/adr/0001-single-active-session-per-user.md`

The frontend app (`epr-register-enrol-frontend`) is where RA-462 was raised and
carries the full design + ADR. This document records the deltas for the
caseworker management app, which has the **same** underlying weakness.

---

## 1. Problem in this app

`src/server/routes/auth/controller.js` → `regulatorCallback` calls
`request.yar.reset()` before `request.yar.set('user', user)` (line ~275). Same in
`src/server/routes/auth/stub/controller.js` → `stubLoginPostController`
(line ~93). `reset()` only touches the current request's session, so a session
established earlier in another browser/device stays valid — concurrent sessions
per caseworker identity, and re-login does not evict the others.

### Two differences from the frontend that matter

1. **No per-request session revalidation exists at all.** The `yar-session`
   scheme is defined *inline and duplicated* in `auth-plugin.js` and
   `stub-auth-plugin.js` (dev branch), and each only does
   `request.yar.get('user')` → authenticated/unauthenticated. The frontend's
   RA-461 idle-timeout refactor (shared `yarSessionAuthenticate` in
   `session-idle-timeout.js`) was never ported here. The supersede check needs a
   home.

2. **yar is not pinned to server-side storage.** `src/server/plugins/session-cache.js`
   does **not** set `maxCookieSize: 0` (the frontend does). Small sessions live
   in the cookie; once `idToken` (a JWT) is stored the session typically exceeds
   yar's 1024-byte default and moves server-side — but it is inconsistent. For a
   cookie-stored old session, `yar.reset()` on another request cannot drop it
   server-side because there is nothing server-side to drop. **The registry
   check (compare `request.yar.id` to the registered id) is therefore the only
   mechanism that can invalidate a superseded session here** — do not rely on
   server-side `drop` alone.
   - Recommended alongside this work: set `maxCookieSize: 0` in
     `session-cache.js` to match the frontend, so session storage semantics are
     consistent across both apps. Size/perf impact is negligible (sessions are
     already near the cookie limit) and it removes a class of surprise. Treat as
     a small separate commit on this branch.

## 2. Design (deltas from the frontend design doc)

Same three pieces: an **active-session registry** (catbox segment on the
existing `session` cache, `userId → { sessionId, loginAt }`), a **write on
login**, an **enforce on every authenticated request**, a **revoke on logout**.
Fail-open on store error; fail-closed on a missing entry.

### 2.1 Registry helper

New: `src/server/common/helpers/auth/active-session-registry.js` (+ `.test.js`).
Identical contract to the frontend helper (`register` / `isCurrent` / `revoke`).
Cache handle from `server.cache({ segment: 'active-sessions', expiresIn: session.cache.ttl })`,
exposed on `server.app.activeSessionRegistry` via a small plugin registered
right after `sessionCache` in `src/server/server.js`.

### 2.2 Extract the shared scheme, then add the check

Preferred: create `src/server/common/helpers/auth/yar-session-authenticate.js`
exporting `yarSessionAuthenticate(request, h)` with the current logic
(`get('user')` → authenticated with `scope: user.roles ?? []`), then have
**both** `auth-plugin.js` and `stub-auth-plugin.js` (dev branch) use it — this
mirrors the frontend's RA-461 consolidation and stops the two schemes drifting.
Then add the supersede check to that one function:

```js
const user = request.yar.get('user')
if (!user) return h.unauthenticated(Boom.unauthorized(null, 'session'))

const registry = request.server.app.activeSessionRegistry
if (isSuperseded(await registrySessionStatus(registry, user.id, request.yar.id))) {
  request.yar.reset()
  return h.unauthenticated(Boom.unauthorized(null, 'session'))
}

return h.authenticated({ credentials: { ...user, scope: user.roles ?? [] } })
```

Minimal alternative if the extraction is deemed too big for this branch: apply
the same check inline in both schemes. Extraction is strongly preferred.

`redirectToLogin` (`onPreResponse`, registered by both plugins) already turns
`Boom.unauthorized(null, 'session')` into a 302 to `/auth/regulator/login` with
the post-login redirect stashed — no change there.

The `NODE_ENV=test` `test-bypass` scheme does not use this function and is
unaffected.

### 2.3 Write on login

After `request.yar.reset()` + `request.yar.set('user', user)`:

- `src/server/routes/auth/controller.js` → `regulatorCallback` (~line 275–282).
  `user.id` = `claims.oid ?? claims.sub`.
- `src/server/routes/auth/stub/controller.js` → `stubLoginPostController`, both
  the `loginAs === 'support'` branch and the caseworker branch (~line 93–125).
  `user.id` = `stub-support-user` / `STUB_USERS[0].id`.

Note `stubLoginPostController` is currently synchronous — the best-effort
registry write can stay fire-and-forget (`void register(...)`) or the handler
can be made `async`. Fire-and-forget is fine given it is dev/stub only; the real
callback is already `async`.

### 2.4 Revoke on logout

`src/server/routes/auth/controller.js` → `logout`. It currently reads only
`idToken`. Add a `user` read before the first `request.yar.reset()`:

```js
const user = request.yar.get('user')
const idToken = request.yar.get('idToken')
if (user?.id) await revoke(registry, user.id)
```

`logout` is currently synchronous — make it `async` (it already `return
h.redirect(...)`, no behavioural change) or fire-and-forget the `revoke`.

## 3. Files to change

| File | Change |
| --- | --- |
| `src/server/common/helpers/auth/active-session-registry.js` (+ `.test.js`) | **New.** Registry helper. |
| `src/server/common/helpers/auth/yar-session-authenticate.js` (+ `.test.js`) | **New.** Extracted shared scheme `authenticate` + supersede check. |
| `src/server/common/helpers/auth/auth-plugin.js` | Use the shared `yarSessionAuthenticate`. |
| `src/server/common/helpers/auth/stub-auth-plugin.js` | Use the shared `yarSessionAuthenticate` in the dev (non-test) branch. |
| `src/server/common/helpers/auth/auth-plugin.test.js` | Update for the extracted function; add current/superseded/store-error cases. |
| `src/server/routes/auth/controller.js` | Registry write in `regulatorCallback`; registry revoke in `logout` (make `async`). |
| `src/server/routes/auth/controller.test.js` | Assert write-after-reset on login; revoke on logout. |
| `src/server/routes/auth/stub/controller.js` | Registry write in both `stubLoginPostController` branches. |
| `src/server/routes/auth/stub/controller.test.js` (or equivalent) | Assert registry write on stub login. |
| `src/server/plugins/session-cache.js` | *Recommended:* add `maxCookieSize: 0` (§1.2). Separate commit. |
| `src/server/server.js` / small plugin | `server.cache({ segment: 'active-sessions', ... })` → `server.app.activeSessionRegistry`. |
| `docs/authentication.md` | Add "Single active session" subsection. |

## 4. Test plan (unit / integration — this repo)

1. Login as caseworker → cookie C1. Login again same identity → cookie C2.
   Protected route with C1 → 302 to `/auth/regulator/login`; with C2 → 200.
2. Support-user login supersedes a prior support-user session likewise.
3. Fail-open: registry `get` throws → valid current session still 200.
4. Missing entry (simulate eviction) → 302 to login (fail-closed on absence).
5. Logout drops the registry entry for that `user.id`.
6. Registry write uses the post-`reset()` `yar.id`.
7. `NODE_ENV=test` bypass suite stays green.
8. If `maxCookieSize: 0` is added: existing session/`yar` tests still pass;
   `route-scope-coverage` and work-items filter-persistence tests (RA-299) still
   pass.

## 5. Manual verification (EXT-TEST / management)

1. Log in as the same caseworker (real Entra ID) in Browser A and Browser B.
2. Browser B authenticated; then Browser A → any protected page → redirected to
   regulator login.
3. Confirm single-browser login/logout and the RA-299 work-items filter
   behaviour are unchanged.

## 6. Out of scope

Device list / active termination UI; new-login notification; `epr-register-enrol-management-be`
(stateless, token-checked).
