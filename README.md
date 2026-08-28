# EPR Register Enrol Management Frontend

A Node.js / [Hapi](https://hapi.dev/) frontend for the EPR Register case
management service. Built from
[cdp-node-frontend-template](https://github.com/DEFRA/cdp-node-frontend-template)
and styled with the [GOV.UK Design System](https://design-system.service.gov.uk/).

The frontend renders GDS-compliant pages and calls the
[`epr-register-enrol-management-be`](../epr-register-enrol-management-be/)
HTTP API server-to-server.

- [Requirements](#requirements)
- [Local development](#local-development)
- [Running with Docker Compose](#running-with-docker-compose)
- [Running the full stack](#running-the-full-stack)
- [Backend integration](#backend-integration)
- [Configuration](#configuration)
- [Testing](#testing)
- [Licence](#licence)

## Requirements

- Node.js 24+ (managed via [`nvm`](https://github.com/nvm-sh/nvm) — `nvm use`)
- npm 10+
- [Docker](https://www.docker.com/) and Docker Compose (for the Docker workflow)
- The [case management backend](../epr-register-enrol-management-be/)
  running on `http://localhost:8085` (see backend README)

## Local development

Install dependencies and start the dev server with hot reload:

```bash
nvm use
npm install
npm run dev
```

The frontend listens on `http://localhost:3000`. Routes:

- `/` — Home
- `/about` — About page
- `/backend-status` — Calls the backend's `/health` endpoint and renders
  the result. Use this to verify the integration is wired correctly.
- `/health` — Frontend health probe

The dev server uses CatboxMemory for session storage (no Redis required
locally) and serves Vite-built assets. Set `BACKEND_API_URL` to point at
a non-default backend location.

## Running with Docker Compose

The Compose stack builds the frontend image, the sibling backend image
and brings up Redis, MongoDB and Floci (AWS emulator):

```bash
docker compose up --build -d
```

Once healthy, browse to `http://localhost:3000`. The
`/backend-status` page should report **Reachable**, confirming the
frontend has called the backend's `/health` endpoint over the internal
Docker network.

Tear it down with:

```bash
docker compose down -v
```

> The frontend Compose file builds the backend image directly from the
> sibling repository at `../epr-register-enrol-management-be`. If
> you keep the two repos in different parent directories, adjust the
> `build:` path in [compose.yml](compose.yml) accordingly.

## Running the full stack

The simplest way to run both services together is the frontend's Compose
file (above) — it includes the backend, MongoDB and Redis.

If you'd rather run each repo's Compose stack independently, ensure they
share the `cdp-tenant` Docker network and that the frontend's
`BACKEND_API_URL` points at the backend service.

To run both natively (no Docker):

```bash
# In epr-register-enrol-management-be
docker compose up -d mongodb       # or run MongoDB locally
dotnet run --project Backend.Api --launch-profile Backend.Api

# In epr-register-enrol-management-fe
npm run dev
```

## Backend integration

- Backend client: [`src/server/common/helpers/backend-api/backend-api.js`](src/server/common/helpers/backend-api/backend-api.js)
- Status page controller: [`src/server/routes/backend-status/controller.js`](src/server/routes/backend-status/controller.js)
- Configuration key: `backendApi.url` (env: `BACKEND_API_URL`)

The backend is called using `undici`'s global `fetch` so it picks up the
forward-proxy configured in [`setup-proxy.js`](src/server/common/helpers/proxy/setup-proxy.js)
when running in environments that require it.

## Configuration

Configuration is managed via [`convict`](https://github.com/mozilla/node-convict) —
see [`src/config/config.js`](src/config/config.js) for the full schema, and
[`docs/cdp-deployment.md`](docs/cdp-deployment.md) for the full
per-environment required-secrets reference.

### Backend integration

| Variable                          | Default                 | Description                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                            | `3000`                  | Frontend HTTP port                                                                                                                                                                                                                                                                                                      |
| `BACKEND_API_URL`                 | `http://localhost:8085` | Base URL of the case management backend                                                                                                                                                                                                                                                                                 |
| `BACKEND_API_CLIENT_ID`           | `frontend`              | Sent as `x-cdp-client-id` on every request to the backend                                                                                                                                                                                                                                                               |
| `BACKEND_API_SHARED_SECRET`       | _(blank)_               | **Secret.** HMAC-SHA256 key this app signs its outbound calls to `epr-register-enrol-management-be` with — must match management-be's `AUTH_SHARED_SECRET__MANAGEMENT_FE` exactly, and must be _distinct_ from `epr-register-enrol-backend`'s own management-be secret (RA-345). Blank locally means signing is a no-op |
| `BACKEND_API_TIMEOUT_MS`          | `5000`                  | Default backend request timeout                                                                                                                                                                                                                                                                                         |
| `BACKEND_API_DECISION_TIMEOUT_MS` | `60000`                 | Timeout for the re-accreditation decision call specifically (RA-410)                                                                                                                                                                                                                                                    |
| `BACKEND_API_APPROVE_TIMEOUT_MS`  | `25000`                 | Timeout for the re-accreditation approve call specifically (RA-448)                                                                                                                                                                                                                                                     |

### Session and cache

| Variable               | Default        | Description                                                                                                                                                                            |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_CACHE_ENGINE` | `memory` (dev) | `memory` or `redis`. Memory is ephemeral                                                                                                                                               |
| `REDIS_HOST`           | `127.0.0.1`    | Used when `SESSION_CACHE_ENGINE=redis`                                                                                                                                                 |
| `REDIS_TLS`            | `false`        | Enables TLS for the Redis connection                                                                                                                                                   |
| `REDIS_USERNAME`       | _(none)_       | Required (with `REDIS_PASSWORD`) whenever `REDIS_TLS=true` or `NODE_ENV=production`                                                                                                    |
| `REDIS_PASSWORD`       | _(none)_       | **Secret.** Required alongside `REDIS_USERNAME` under the same condition — boot fails loudly if `REDIS_HOST` is still localhost/blank, or either is blank, once that condition applies |

> Session storage uses CatboxMemory by default in development; Redis is
> only required for production-style local runs (e.g. via Compose). Both
> are intentionally ephemeral — the frontend holds no persistent data.

**Production secrets.** `SESSION_COOKIE_PASSWORD` must be set to a
unique ≥32-char secret per environment (provisioned via AWS Secrets
Manager — see [`docs/cdp-deployment.md`](docs/cdp-deployment.md)). The
public placeholder default ships only for local dev convenience; boot
fails loudly if it is still in use when `NODE_ENV=production` or
`SESSION_COOKIE_SECURE=true`.

### Entra ID (regulator/case-worker sign-in)

| Variable                 | Default                 | Description                                                                                                                                    |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENTRA_CLIENT_ID`        | _(blank)_               | **Secret.** Azure Entra ID app registration client ID                                                                                          |
| `ENTRA_CLIENT_SECRET`    | _(blank)_               | **Secret.** Paired client secret                                                                                                               |
| `ENTRA_TENANT_ID`        | _(blank)_               | Azure AD tenant ID                                                                                                                             |
| `AUTH_CALLBACK_BASE_URL` | `http://localhost:3000` | Base URL used to build the Entra ID OAuth `redirect_uri`. Boot fails loudly outside `environment=local` if this is still the localhost default |
| `AUTH_STUB_ENABLED`      | `true` (non-prod)       | Bypasses real OAuth, auto-authenticates as a fixed stub case-worker                                                                            |

All three Entra values are required at boot in production whenever
`AUTH_STUB_ENABLED=false`; leave blank for a local run under stub auth.
Likewise, `AUTH_STUB_ENABLED` must be `false` when `ENVIRONMENT=prod` — the
stub auth provider auto-authenticates every request and bypasses real
OAuth, so boot fails loudly if stub auth is enabled in that environment. It
may be set to `true` in other deployed environments (e.g. `dev`, `test`)
while real OAuth is being wired up.

### HTTP Basic Auth (preview-environment gate)

| Variable             | Default  | Description                                                                                                                                                               |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_BASIC_ENABLED` | `false`  | Gate the whole app behind HTTP basic auth (e.g. for a preview environment). Requires `BASIC_USER` and `BASIC_PASSWD` — boot fails loudly if either is empty while enabled |
| `BASIC_USER`         | _(none)_ | Username for HTTP basic auth                                                                                                                                              |
| `BASIC_PASSWD`       | _(none)_ | **Secret.** Password for HTTP basic auth                                                                                                                                  |

**HTTP basic auth.** When `AUTH_BASIC_ENABLED=true`, every request must
carry an `Authorization: Basic` header matching `BASIC_USER`/`BASIC_PASSWD`,
except `/health`, `/favicon.ico`, `/public/**` and the OAuth callback route
— see [`basic-auth-plugin.js`](src/server/common/helpers/auth/basic-auth-plugin.js)
for the exact exclusion list. This sits in front of, and is independent
from, the app's own OAuth/stub auth — it's intended for gating access to a
whole preview environment rather than replacing user sign-in.

### File download and feature flags

| Variable                     | Default                           | Description                                                                                                                                                                                                         |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FILE_UPLOAD_S3_BUCKET`      | `epr-register-enrol-file-uploads` | S3 bucket sampling-plan/BES-evidence files are downloaded from — fallback used only when an individual file record has no bucket of its own. Must match `epr-register-enrol-frontend`'s own `FILE_UPLOAD_S3_BUCKET` |
| `WORK_ITEM_CREATION_ENABLED` | `true`                            | Feature flag (RA-127) gating the demo "create a work item" form and button. When off, those routes aren't mounted (404)                                                                                             |

> `WORK_ITEM_CREATION_ENABLED` currently defaults to `true` in **every**
> environment, including production — [`docs/cdp-deployment.md`](docs/cdp-deployment.md)
> currently states it defaults to `false` in production, which no longer
> matches `src/config/config.js` (there's no environment-conditional branch
> there). Worth reconciling that doc against the code: as written today the
> demo flow is on in prod unless something outside this repo's visibility
> (AWS Secrets Manager) overrides it.

### Example local/testing values

```bash
BACKEND_API_SHARED_SECRET=local-dev-backend-shared-secret-not-real
ENTRA_CLIENT_ID=local-dev-entra-client-id
ENTRA_CLIENT_SECRET=local-dev-fake-entra-secret
ENTRA_TENANT_ID=00000000-0000-0000-0000-000000000000
SESSION_COOKIE_PASSWORD=the-password-must-be-at-least-32-characters-long
FILE_UPLOAD_S3_BUCKET=epr-register-enrol-file-uploads
```

`AUTH_STUB_ENABLED=true` (the local default) makes the Entra ID values
above irrelevant for a plain local run.

See [`src/config/config.js`](src/config/config.js) for the full schema.

## Testing

```bash
npm test
```

Tests run with [Vitest](https://vitest.dev/) and start the Hapi server
with `server.inject` for route-level assertions. The backend client is
covered by unit tests with a mocked `fetch`.

## Deployment

This service targets the CDP platform. See
[`docs/cdp-deployment.md`](docs/cdp-deployment.md) for the container port,
required environment variables, secrets, AWS resources and Squid proxy
allow-list.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT
LICENCE found at: <http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>.
