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

Real Entra ID login requires the caller's id_token `roles` claim to include
the value configured by `ENTRA_REGULATOR_ROLE_VALUE` (see below); a signed-in
user without it is bounced back to the login page rather than granted a
session.

Use the helper from `src/server/common/helpers/auth/auth-scopes.js` to
require an authenticated caseworker at the framework level:

```javascript
import { requireStandard } from '../common/helpers/auth/auth-scopes.js'

server.route({
  method: 'POST',
  path: '/work-items/{id}/assign',
  options: requireStandard,
  handler: assignController
})
```

## Environment variables

| Variable                     | Description                                                                                              | Default                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------- |
| `ENVIRONMENT`                | Deployment environment name                                                                              | `local`                    |
| `AUTH_STUB_ENABLED`          | Enable stub auth. Defaults `true` when `ENVIRONMENT != prod`                                             | `true`                     |
| `AUTH_CALLBACK_BASE_URL`     | Base URL used to build OAuth callback redirect URI                                                       | `http://localhost:3000`    |
| `AZURE_CLIENT_ID`            | Azure Entra ID client ID                                                                                 | _(empty)_                  |
| `AZURE_CLIENT_SECRET`        | Azure Entra ID client secret                                                                             | _(empty)_                  |
| `AZURE_TENANT_ID`            | Azure Entra ID tenant ID                                                                                 | _(empty)_                  |
| `ENTRA_REGULATOR_ROLE_VALUE` | RA-323. App role a signed-in user must hold to be treated as a caseworker. Unconfirmed pending sign-off. | `Waste.Regulator.Standard` |

## Routes

| Method | Path                       | Notes                                          |
| ------ | -------------------------- | ---------------------------------------------- |
| GET    | `/auth/regulator/login`    | Initiates OAuth (or redirects to stub chooser) |
| GET    | `/auth/regulator/callback` | OAuth callback — exchanges code for session    |
| GET    | `/auth/logout`             | Clears the session                             |
| GET    | `/auth/stub/login`         | Stub chooser (stub mode only)                  |
| POST   | `/auth/stub/login`         | Submits stub user selection                    |

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
