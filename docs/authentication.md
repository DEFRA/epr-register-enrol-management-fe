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

Two roles are recognised:

- `standard` — view and progress work items
- `assign` — additionally able to assign work items to other users

Use the helpers from `src/server/common/helpers/auth/auth-scopes.js` to enforce role at the framework level:

```javascript
import { requireAssign } from '../common/helpers/auth/auth-scopes.js'

server.route({
  method: 'POST',
  path: '/work-items/{id}/assign',
  options: requireAssign,
  handler: assignController
})
```

## Environment variables

| Variable                 | Description                                                  | Default                 |
| ------------------------ | ------------------------------------------------------------ | ----------------------- |
| `ENVIRONMENT`            | Deployment environment name                                  | `local`                 |
| `AUTH_STUB_ENABLED`      | Enable stub auth. Defaults `true` when `ENVIRONMENT != prod` | `true`                  |
| `AUTH_CALLBACK_BASE_URL` | Base URL used to build OAuth callback redirect URI           | `http://localhost:3000` |
| `AZURE_CLIENT_ID`        | Azure Entra ID client ID                                     | _(empty)_               |
| `AZURE_CLIENT_SECRET`    | Azure Entra ID client secret                                 | _(empty)_               |
| `AZURE_TENANT_ID`        | Azure Entra ID tenant ID                                     | _(empty)_               |

## Routes

| Method | Path                       | Notes                                          |
| ------ | -------------------------- | ---------------------------------------------- |
| GET    | `/auth/regulator/login`    | Initiates OAuth (or redirects to stub chooser) |
| GET    | `/auth/regulator/callback` | OAuth callback — exchanges code for session    |
| GET    | `/auth/logout`             | Clears the session                             |
| GET    | `/auth/stub/login`         | Stub chooser (stub mode only)                  |
| POST   | `/auth/stub/login`         | Submits stub user selection                    |

## Tests

The test bypass auto-authenticates each request as the assign user. To test as a `standard`-only user:

```javascript
const { statusCode } = await server.inject({
  method: 'GET',
  url: '/work-items',
  headers: { 'x-test-user-role': 'standard' }
})
```
