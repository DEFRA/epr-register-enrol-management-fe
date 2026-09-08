# RA-462 — Concurrent-login notification (caseworker app)

**Status:** Implemented on `feature/RA-462-ConcurrentLogins`. Policy chosen by
product 2026-09-02: **allow concurrent sessions, notify the user with a
dismissible toast** (no forced sign-out). Behind
`SESSION_CONCURRENT_LOGIN_NOTICE_ENABLED` (default on).

Primary ADR + full narrative:
`epr-register-enrol-frontend/docs/adr/0001-single-active-session-per-user.md`
and `epr-register-enrol-frontend/docs/RA-462-concurrent-logins-design.md`.
This file records only what differs in the caseworker app.

---

## What shipped

Same shape as the frontend, but **one module** instead of several:

- **`src/server/common/helpers/auth/concurrent-login.js`** (+ `.test.js`) —
  everything server-side: the per-identity registry (`server.cache` segment
  `concurrent-login` on the existing `session` cache), `recordLogin` /
  `markLoginAndNotifyPrevious` / `clearLogin` for the auth controllers, the
  `onPostAuth` handler, `dismissNotice`, and `concurrentLoginPlugin`
  (registered in `server.js` right after `sessionCache`).
- **`src/config/config.js`** — `session.concurrentLoginNotice.enabled`
  (`SESSION_CONCURRENT_LOGIN_NOTICE_ENABLED`, default `true`).
- **`src/server/routes/auth/controller.js`** — `regulatorCallback`: `loginAt`
  stamp + `markLoginAndNotifyPrevious`. `logout`: kept synchronous,
  `clearLogin(...).catch(() => {})` fire-and-forget.
- **`src/server/routes/auth/stub/controller.js`** — `stubLoginPostController`
  made `async`; `markLoginAndNotifyPrevious` after each `yar.set('user', ...)`
  (caseworker + support-user branches).
- **`src/server/routes/auth/session-notice/{index,controller}.js`**
  (+ `.test.js`) — `POST /auth/session-notice/dismiss`, auth + crumb; records
  `noticeDismissedFor`, clears `concurrentLoginInfo`, then `204` for a `fetch`
  or a **same-host** redirect back for the no-JS form.
- **`src/config/nunjucks/context/context.js`** (+ `.test.js`) — surfaces
  `concurrentLoginNotice`.
- **`src/server/common/components/session-notice/{macro.njk,macro.test.js}`**
  — the notice markup, with its **own** `app-session-notice__*` classes (not
  `govuk-notification-banner`), `role="alert"` / `role="status"` by variant,
  no-JS "Hide" form.
- **`src/server/common/templates/layouts/page.njk`** — renders the component
  in `beforeContent`.
- **`src/client/javascripts/session-notice.js`** — progressive enhancement:
  lifts it into a fixed toast, `aria-live`, Escape, `fetch` dismiss with
  form-submit fallback. Excluded from coverage (no jsdom here) — exercised by
  `epr-register-enrol-mgmt-tests`.
- **`src/client/stylesheets/components/_session-notice.scss`** — reproduces
  the notification-banner look for the custom classes.
- **`sonar-project.properties`** — `sonar.coverage.exclusions=src/client/**`.

## Mechanism

- **On login** (`markLoginAndNotifyPrevious`): stamp `loginAt` on the yar
  session; read the prior registry entry; if one exists for a **different**
  session, arm a one-shot `concurrentLoginInfo` flag on this new session; then
  overwrite the registry entry with `{ lastLoginAt, lastLoginSessionId }`.
- **On every authenticated request** (`concurrentLoginPlugin`'s **global**
  `onPostAuth` — not per auth scheme): if the flag is on and the request is
  authenticated with a `user.id`, compute a notice into
  `request.app.concurrentLoginNotice`. **Alert wins over info** — a newer login
  elsewhere (registry entry with a different `lastLoginSessionId` and
  `lastLoginAt` past both this session's `loginAt` and its `noticeDismissedFor`)
  is the security-relevant message; the info flag is the fallback.
  Unauthenticated requests and `NODE_ENV=test` (`test-bypass`, no yar session
  primed) reach the extension and return early.
- **Fail open:** any registry read/write error is logged and swallowed — no
  notice, session untouched.
- **On logout** (`clearLogin`): drop the registry entry **only if it points at
  the session logging out**, so a logout by one session doesn't blind the
  identity's other live sessions.
- **Dismissal:** `noticeDismissedFor = max(existing, latest login time)` on the
  session; the notice stays gone until a still-newer sign-in.

## Deviations from the frontend

- `logout` stays synchronous (RA-306 unit tests call it without `await`); the
  registry cleanup is fire-and-forget.
- English-only — no `translation.json`; copy is inline in the macro.
- `session-cache.js` still lacks `maxCookieSize: 0`; the new session keys are
  small enough to ride in the cookie. Not changed here — a possible future
  tidy for parity with the frontend.
- `src/client/**` is excluded from both vitest coverage and the SonarCloud
  coverage gate (no jsdom test setup in this repo).

## Not done (follow-ups)

- The `yar-session` scheme here still has no RA-461 per-request idle-timeout
  revalidation (the frontend has it). Out of scope for RA-462; worth its own
  ticket.
- No "sign out all other sessions" action — the toast links to `/auth/logout`
  for the current session only.

## E2E

`epr-register-enrol-mgmt-tests/test/specs/ra-462-concurrent-logins.e2e.js` —
scoped to what a single spec can verify in the parallel journey grid (the
just-signed-in session sees a notice; the older session is not signed out; the
notice dismisses). The alert/info variant and dismissal persistence are
covered by `concurrent-login.test.js`.
