# CDP deployment configuration

This document captures the metadata required to deploy
`epr-register-case-management-frontend-poc` onto the CDP platform. It
complements the official
[CDP documentation](https://github.com/DEFRA/cdp-documentation) — refer to
those how-tos for the authoritative platform behaviour.

## Service identity

| Attribute      | Value                                       |
| -------------- | ------------------------------------------- |
| Service name   | `epr-register-case-management-frontend-poc` |
| Runtime        | Node.js 24 (`node24`) running Hapi          |
| Container port | `3000`                                      |
| Health probe   | `GET /health` (anonymous, returns `200`)    |

## Required environment variables

| Variable                        | Source            | Notes                                                                                                                                                                                                                          |
| ------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                          | Container         | `3000` (matches `EXPOSE`).                                                                                                                                                                                                     |
| `NODE_ENV`                      | CDP platform      | `production` in deployed environments.                                                                                                                                                                                         |
| `ENVIRONMENT`                   | CDP platform      | One of `infra-dev`/`management`/`dev`/`test`/`perf-test`/`ext-test`/`prod`.                                                                                                                                                    |
| `BACKEND_API_URL`               | Service config    | URL of the case-management backend in the same environment.                                                                                                                                                                    |
| `BACKEND_API_COGNITO_CLIENT_ID` | Service config    | Sent as `x-cdp-cognito-client-id` to the backend.                                                                                                                                                                              |
| `SESSION_CACHE_ENGINE`          | Service config    | `redis` in deployed environments.                                                                                                                                                                                              |
| `REDIS_HOST`                    | CDP Redis binding | ElastiCache hostname.                                                                                                                                                                                                          |
| `REDIS_TLS`                     | Service config    | `true` in deployed environments.                                                                                                                                                                                               |
| `SESSION_COOKIE_PASSWORD`       | **Secret**        | ≥32 chars, generated per environment. **Must** be supplied via Secrets Manager in every deployed env — boot fails loudly if `NODE_ENV=production` or `SESSION_COOKIE_SECURE=true` and the placeholder default is still in use. |
| `SESSION_COOKIE_SECURE`         | Service config    | `true` in deployed environments.                                                                                                                                                                                               |
| `TRACING_HEADER`                | Service config    | Defaults to `x-cdp-request-id`.                                                                                                                                                                                                |
| `HTTP_PROXY`                    | CDP platform      | CDP outbound proxy for plain HTTP. Wired onto `global-agent` for legacy HTTP clients.                                                                                                                                          |
| `HTTPS_PROXY`                   | CDP platform      | CDP outbound proxy for HTTPS (the common case — backend calls are HTTPS in deployed envs). Used by undici's global dispatcher (the `fetch` exported from `undici`). Falls back to `HTTP_PROXY` if unset.                       |
| `ENABLE_SECURE_CONTEXT`         | Service config    | `true` in production (loads CDP CA bundle).                                                                                                                                                                                    |
| `AUTH_STUB_ENABLED`             | Service config    | **Must** be `false` in `prod` — boot fails loudly if `NODE_ENV=production` and stub auth is enabled. `true` elsewhere until real Cognito is wired.                                                                             |

## Required secrets (cdp-portal)

- `SESSION_COOKIE_PASSWORD` — random ≥32-char string, distinct per
  environment. Provisioned via AWS Secrets Manager and injected as an
  env var. The boot-time hardening assertion in
  [`src/config/config.js`](../src/config/config.js) refuses to start the
  process if this is missing (i.e. still set to the public placeholder
  default) when the cookie is configured as secure or `NODE_ENV=production`.
- `COGNITO_CLIENT_SECRET` — once real Cognito auth is wired up (currently
  stubbed in non-prod). `AUTH_STUB_ENABLED` **must** remain `false` in
  `prod`; the same hardening assertion fails boot if stub auth is ever
  enabled in production.

## AWS resources to provision

- ECR repository (named after the service).
- ElastiCache (Redis) — needed for clustered session storage in deployed
  environments.
- CloudWatch log group + dashboard (auto-created from EMF metrics emitted
  by `@defra/cdp-metrics`).

## Squid proxy allow-list

- `cognito-idp.eu-west-2.amazonaws.com` — Cognito hosted UI / OIDC.
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
