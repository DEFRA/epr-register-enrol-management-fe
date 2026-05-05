# EPR Register Case Management Frontend (PoC)

A proof-of-concept Node.js / [Hapi](https://hapi.dev/) frontend for the EPR
Register case management service. Built from
[cdp-node-frontend-template](https://github.com/DEFRA/cdp-node-frontend-template)
and styled with the [GOV.UK Design System](https://design-system.service.gov.uk/).

The frontend renders GDS-compliant pages and calls the
[`epr-register-case-management-backend-poc`](../epr-register-case-management-backend-poc/)
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
- The [case management backend](../epr-register-case-management-backend-poc/)
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
> sibling repository at `../epr-register-case-management-backend-poc`. If
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
# In epr-register-case-management-backend-poc
docker compose up -d mongodb       # or run MongoDB locally
dotnet run --project Backend.Api --launch-profile Backend.Api

# In epr-register-case-management-frontend-poc
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

Configuration is managed via [`convict`](https://github.com/mozilla/node-convict).
Notable environment variables for local integration:

| Variable                 | Default                 | Description                               |
| ------------------------ | ----------------------- | ----------------------------------------- |
| `PORT`                   | `3000`                  | Frontend HTTP port                        |
| `BACKEND_API_URL`        | `http://localhost:8085` | Base URL of the case management backend   |
| `BACKEND_API_TIMEOUT_MS` | `5000`                  | Backend request timeout                   |
| `SESSION_CACHE_ENGINE`   | `memory` (dev)          | `memory` or `redis`. Memory is ephemeral. |
| `REDIS_HOST`             | `127.0.0.1`             | Used when `SESSION_CACHE_ENGINE=redis`    |

> Session storage uses CatboxMemory by default in development; Redis is
> only required for production-style local runs (e.g. via Compose). Both
> are intentionally ephemeral — the frontend holds no persistent data.

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
