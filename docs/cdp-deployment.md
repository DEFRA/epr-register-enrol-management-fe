# CDP deployment configuration

This document captures the metadata required to deploy
`epr-register-enrol-management-fe` onto the CDP platform. It
complements the official
[CDP documentation](https://github.com/DEFRA/cdp-documentation) — refer to
those how-tos for the authoritative platform behaviour.

## Service identity

| Attribute      | Value                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service name   | `epr-register-enrol-management-fe`                                                                                                                |
| Runtime        | Node.js 24 (`node24`) running Hapi                                                                                                                |
| Container port | `3000`                                                                                                                                            |
| Health probe   | `GET /health` (anonymous, returns `200`)                                                                                                          |
| Readiness      | `GET /health/ready` (anonymous, `200`/`503`) — reports missing required config by key name; not wired to any platform probe today, curl on demand |

## Required environment variables

| Variable                          | Source            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                            | Container         | `3000` (matches `EXPOSE`).                                                                                                                                                                                                                                                                                                                                                                                                        |
| `NODE_ENV`                        | CDP platform      | `production` in deployed environments.                                                                                                                                                                                                                                                                                                                                                                                            |
| `ENVIRONMENT`                     | CDP platform      | One of `infra-dev`/`management`/`dev`/`test`/`perf-test`/`ext-test`/`prod`.                                                                                                                                                                                                                                                                                                                                                       |
| `BACKEND_API_URL`                 | Service config    | URL of the case-management backend in the same environment.                                                                                                                                                                                                                                                                                                                                                                       |
| `BACKEND_API_CLIENT_ID`           | Service config    | Sent as `x-cdp-client-id` to the backend.                                                                                                                                                                                                                                                                                                                                                                                         |
| `BACKEND_API_TIMEOUT_MS`          | Service config    | Per-call timeout for backend API calls. Defaults to `5000`. Applies to every backend call EXCEPT the re-accreditation decision (see below).                                                                                                                                                                                                                                                                                       |
| `BACKEND_API_DECISION_TIMEOUT_MS` | Service config    | Per-call timeout for `POST /work-items/re-accreditation/{id}/decision` only. Defaults to `60000`. Must stay comfortably above management-be's Registration & Accreditation service-push retry budget (~28s worst case) so fe never aborts before be returns its clean HTTP 500 — a premature abort re-opens the RA-410 stranding bug. Raise both this and be's `DecisionPush*` knobs together if ops ever tunes the retry budget. |
| `SESSION_CACHE_ENGINE`            | Service config    | `redis` in deployed environments.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `REDIS_HOST`                      | CDP Redis binding | ElastiCache hostname.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `REDIS_TLS`                       | Service config    | `true` in deployed environments.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `SESSION_COOKIE_PASSWORD`         | **Secret**        | ≥32 chars, generated per environment. **Must** be supplied via Secrets Manager in every deployed env — boot fails loudly if `NODE_ENV=production` or `SESSION_COOKIE_SECURE=true` and the placeholder default is still in use.                                                                                                                                                                                                    |
| `SESSION_COOKIE_SECURE`           | Service config    | `true` in deployed environments.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TRACING_HEADER`                  | Service config    | Defaults to `x-cdp-request-id`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `HTTP_PROXY`                      | CDP platform      | CDP outbound proxy for plain HTTP. Wired onto `global-agent` for legacy HTTP clients.                                                                                                                                                                                                                                                                                                                                             |
| `HTTPS_PROXY`                     | CDP platform      | CDP outbound proxy for HTTPS (the common case — backend calls are HTTPS in deployed envs). Used by undici's global dispatcher (the `fetch` exported from `undici`). Falls back to `HTTP_PROXY` if unset.                                                                                                                                                                                                                          |
| `ENABLE_SECURE_CONTEXT`           | Service config    | `true` in production (loads CDP CA bundle).                                                                                                                                                                                                                                                                                                                                                                                       |
| `AUTH_STUB_ENABLED`               | Service config    | **Must** be `false` when `ENVIRONMENT=prod` — boot fails loudly if both conditions are true. Defaults to `true` whenever `ENVIRONMENT !== 'prod'`, so non-prod environments run stub auth unless explicitly overridden. Can be set to `true` in other deployed environments (e.g. `dev`, `test`) to bypass OAuth while real auth is being wired up.                                                                               |
| `ENTRA_CLIENT_ID`                 | Service config    | Azure Entra ID app registration client ID. Required (boot fails) in production when `AUTH_STUB_ENABLED=false`.                                                                                                                                                                                                                                                                                                                    |
| `ENTRA_TENANT_ID`                 | Service config    | Azure Entra ID tenant ID, used to build the Microsoft OAuth URLs.                                                                                                                                                                                                                                                                                                                                                                 |
| `ENTRA_REGULATOR_ROLE_VALUE`      | Service config    | Entra app role value that identifies a regulator user.                                                                                                                                                                                                                                                                                                                                                                            |
| `ENTRA_SUPPORT_USER_ROLE_VALUE`   | Service config    | Entra app role value that identifies a support user.                                                                                                                                                                                                                                                                                                                                                                              |
| `WORK_ITEM_CREATION_ENABLED`      | Service config    | RA-127 demo. Toggles the "Create work item" form (`GET`/`POST /work-items/re-accreditation/new`) and the entry point on the work items list page. Defaults to `true` in every environment, production included (`src/config/config.js`); set it to `false` to opt out.                                                                                                                                                            |

## Required secrets (cdp-portal)

- `SESSION_COOKIE_PASSWORD` — random ≥32-char string, distinct per
  environment. Provisioned via AWS Secrets Manager and injected as an
  env var. The boot-time hardening assertion in
  [`src/config/config.js`](../src/config/config.js) refuses to start the
  process if this is missing (i.e. still set to the public placeholder
  default) when the cookie is configured as secure or `NODE_ENV=production`.
- `ENTRA_CLIENT_SECRET` — Azure Entra ID app registration client secret
  (regulator/support-user sign-in). Real auth is implemented via Entra ID
  (`src/server/routes/auth`), selected over the stub provider by
  `select-auth-plugin.js` whenever `AUTH_STUB_ENABLED` is false. `AUTH_STUB_ENABLED`
  **must** remain `false` when `ENVIRONMENT=prod`; the boot-time hardening
  assertion fails if stub auth is enabled in that environment. A separate
  guard (gated on `isProduction`, not `ENVIRONMENT=prod` specifically —
  see `src/config/config.js`) requires both `ENTRA_CLIENT_ID` and
  `ENTRA_CLIENT_SECRET` to be non-empty whenever stub auth is off in a
  production build.
- `BACKEND_API_SHARED_SECRET` — HMAC-SHA256 secret this service signs its
  outbound requests to the case management backend with (sent as
  `x-cdp-auth-signature` alongside `BACKEND_API_CLIENT_ID`'s
  value). **Required in all non-Development environments** — the
  boot-time hardening assertion in
  [`src/config/config.js`](../src/config/config.js) refuses to start the
  process otherwise. Must match `AUTH_SHARED_SECRET__MANAGEMENT_FE` on
  `epr-register-enrol-management-be` exactly, and must be **distinct**
  from whatever `epr-register-enrol-backend` uses for its own calls into
  that same backend (`CASE_MANAGEMENT_API_SHARED_SECRET`) — RA-345 moved
  that backend from one secret shared across both callers to a secret per
  caller specifically so a compromise of one doesn't grant the other's
  identity. Generate with `openssl rand -base64 32`.

## AWS resources to provision

- ECR repository (named after the service).
- ElastiCache (Redis) — needed for clustered session storage in deployed
  environments.
- CloudWatch log group + dashboard (auto-created from EMF metrics emitted
  by `@defra/cdp-metrics`).

## Squid proxy allow-list

- `login.microsoftonline.com` — Azure Entra ID hosted login / OIDC endpoints.
- The CDP-internal hostname of the case-management backend (resolved by
  `BACKEND_API_URL`).

## Proxy / secure-context boot ordering

Proxy setup is split into two halves so the CDP CA bundle is in place
before any outbound TLS handshake (see
[`src/server/common/helpers/proxy/setup-proxy.js`](../src/server/common/helpers/proxy/setup-proxy.js)):

1. `setupProxyEnv()` runs **first**, before any plugins register. It
   only mutates `global.GLOBAL_AGENT.HTTP_PROXY` /
   `HTTPS_PROXY` so legacy HTTP clients constructed during plugin
   registration see the proxy. No TLS happens here.
2. `@defra/hapi-secure-context` is registered with the other plugins
   when `ENABLE_SECURE_CONTEXT=true`. This loads the CDP CA bundle into
   Node's trust store.
3. `installProxyDispatcher()` runs **after** the `server.register([...])`
   call. It calls `setGlobalDispatcher(new ProxyAgent(HTTPS_PROXY ??
HTTP_PROXY))` so the `fetch` exported from `undici` (and therefore
   the backend client) routes via the CDP proxy with the correct CA
   trust material in place.

Reversing steps 2 and 3 would make HTTPS to CDP-internal hosts (e.g.
the backend API) fail TLS verification. The ordering is enforced by a
structural test in
[`src/server/server.test.js`](../src/server/server.test.js).

## Related

- [docs/authentication.md](./authentication.md)
- [Registrations-353](#) — register the service in the CDP portal (prereq).
