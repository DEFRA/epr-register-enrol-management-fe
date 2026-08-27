# Authentication

This service authenticates regulator users via Defra Azure Entra ID (OIDC) and exposes a stub provider for local development and tests.

## Modes

| Mode            | When                                                          | Behaviour                                                                      |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Real OAuth**  | `AUTH_STUB_ENABLED=false` (forced when `ENVIRONMENT=prod`)    | Redirects to Azure Entra ID; stores user profile in the yar session            |
| **Stub (dev)**  | `AUTH_STUB_ENABLED=true` (default when `ENVIRONMENT != prod`) | Local chooser at `/auth/stub/login` lets you select a fake regulator user      |
| **Test bypass** | `NODE_ENV=test`                                               | Every request auto-authenticates; override role with `x-test-user-role` header |

All routes are protected by `server.auth.default('session')`. Public routes (health, static assets, login pages) opt out with `auth: false`.

## Roles

RA-323: every caseworker holds the same role — `standard` — with no
permission tiering (previously there were separate `assign`,
`reaccreditation-decision-maker` and `team-leader` roles; these have been
removed, and every caseworker can now assign work items, extend/override an
SLA clock, and approve re-accreditations).

A caseworker's real identity still carries a nation role
(`role:nation-england` etc.) used only to default the worklist filter
(RA-125) — this is unrelated to permissions.

RA-335: a **support user** holds a separate role — `support-readonly` —
identified by a different Entra ID app role
(`ENTRA_SUPPORT_USER_ROLE_VALUE`). A session has exactly one of `standard`
or `support-readonly`, never both. Support users can sign in and view
everything a caseworker can, but:

- every route that mutates a work item requires `requireStandard`
  specifically (not just "any authenticated session") — a support user's
  session is rejected server-side with a 403 even if a disabled UI control
  is bypassed by a crafted request;
- Nunjucks templates read `user.isReadOnly` (set in
  `src/config/nunjucks/context/context.js`) to render every modifying
  action disabled instead of hiding it, so a support user sees exactly
  what a caseworker sees: a submit button gets `disabled: true`, and a
  navigational link (which has no native disabled state) is rendered as
  an inert `<span>` with no `href` via the `appActionLink` macro
  (`src/server/common/components/action-link/macro.njk`);
- the `/backend-status` diagnostic page is visible (nav link) and
  accessible only to a signed-in support user — not caseworkers, not
  signed-out visitors.

Real Entra ID login requires the caller's id_token `roles` claim to include
either the value configured by `ENTRA_REGULATOR_ROLE_VALUE` (caseworker) or
`ENTRA_SUPPORT_USER_ROLE_VALUE` (support user) — see below; a signed-in user
with neither is bounced back to the login page rather than granted a
session.

## Assignable-users directory (RA-446)

The "assign to" / "reassign" work item picker and the work items list's
"specific officer" filter are backed by
`src/server/work-items/core/assignees.js`. In stub-auth environments this
reuses the stub login user list; in real (Entra ID) environments it reads
`src/server/common/helpers/auth/assignable-users-store.js`, a Redis-backed
directory populated incrementally as regulator-role users sign in (there's
no Graph API access to enumerate app-role group membership directly, so the
role check the OAuth callback already performs is reused instead of a
second source of truth):

- on every login where the `roles` claim includes
  `ENTRA_REGULATOR_ROLE_VALUE`, the caller's id/name/email/last-login are
  upserted (stored in a single Redis hash — production runs Redis Cluster,
  where a per-user-key design breaks `KEYS` fan-out and `MGET` across
  slots);
- on every login where it doesn't (including a caller who now only holds
  the support-user role, or neither role at all) any existing entry for
  that caller is removed — catches an active user whose role was revoked;
- every read also excludes and prunes any entry whose last login exceeds
  `ASSIGNABLE_USER_INACTIVITY_DAYS` (default 90), computed live rather than
  via a per-entry TTL, so lowering the value takes effect on the next read
  rather than only for entries written afterwards — catches a
  departed/revoked user who never signs in again to trigger the removal
  above.

A directory read or write failure is logged but degrades gracefully
(empty directory / lookup miss) rather than failing sign-in or the
work-items list. A user who holds the role but has never logged in since
this shipped won't appear as assignable until their first login.

Use the helpers from `src/server/common/helpers/auth/auth-scopes.js` to
require a role at the framework level:

```javascript
import {
  requireStandard,
  requireSupportReadonly
} from '../common/helpers/auth/auth-scopes.js'

server.route({
  method: 'POST',
  path: '/work-items/{id}/assign',
  options: requireStandard,
  handler: assignController
})
```

## Environment variables

| Variable                          | Description                                                                                                                                                    | Default                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `ENVIRONMENT`                     | Deployment environment name                                                                                                                                    | `local`                      |
| `AUTH_STUB_ENABLED`               | Enable stub auth. Defaults `true` when `ENVIRONMENT != prod`                                                                                                   | `true`                       |
| `AUTH_CALLBACK_BASE_URL`          | Base URL used to build OAuth callback redirect URI. Must be set to this environment's public URL outside local dev — boot fails otherwise (see `config.js`).   | `http://localhost:3000`      |
| `ENTRA_CLIENT_ID`                 | Azure Entra ID client ID                                                                                                                                       | _(empty)_                    |
| `ENTRA_CLIENT_SECRET`             | Azure Entra ID client secret                                                                                                                                   | _(empty)_                    |
| `ENTRA_TENANT_ID`                 | Azure Entra ID tenant ID                                                                                                                                       | _(empty)_                    |
| `ENTRA_REGULATOR_ROLE_VALUE`      | RA-323. App role a signed-in user must hold to be treated as a caseworker. Unconfirmed pending sign-off.                                                       | `Waste.Regulator.Standard`   |
| `ENTRA_SUPPORT_USER_ROLE_VALUE`   | RA-335. App role a signed-in user must hold to be treated as a read-only support user.                                                                         | `Waste.SupportUser.ReadOnly` |
| `ASSIGNABLE_USER_INACTIVITY_DAYS` | RA-446. Days since last login before an entry in the real-Entra-ID assignable-users directory is pruned on read. TBC pending an access-review policy decision. | `90`                         |

## Routes

| Method | Path                       | Notes                                                                |
| ------ | -------------------------- | -------------------------------------------------------------------- |
| GET    | `/auth/regulator/login`    | Initiates OAuth (or redirects to stub chooser)                       |
| GET    | `/auth/regulator/callback` | OAuth callback — exchanges code for session                          |
| GET    | `/auth/logout`             | Clears the session                                                   |
| GET    | `/auth/stub/login`         | Stub chooser (stub mode only) — caseworker or support user (RA-335)  |
| POST   | `/auth/stub/login`         | Submits stub user selection                                          |
| GET    | `/backend-status`          | RA-335: support-user-only diagnostic page (`requireSupportReadonly`) |

## Tests

The test bypass auto-authenticates each request as the standard caseworker.
To test as a nation-scoped user (e.g. for the RA-125 default-filter), set
`x-test-user-role` to `nation-england`, `nation-scotland`, `nation-wales` or
`nation-northern-ireland`:

```javascript
const { statusCode } = await server.inject({
  method: 'GET',
  url: '/work-items',
  headers: { 'x-test-user-role': 'nation-england' }
})
```
