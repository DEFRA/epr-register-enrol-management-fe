# CDP deployment configuration

This document captures the metadata required to deploy
`epr-register-case-management-frontend-poc` onto the CDP platform. It
complements the official
[CDP documentation](https://github.com/DEFRA/cdp-documentation) — refer to
those how-tos for the authoritative platform behaviour.

## Service identity

| Attribute      | Value                                           |
| -------------- | ----------------------------------------------- |
| Service name   | `epr-register-case-management-frontend-poc`     |
| Runtime        | Node.js 24 (`node24`) running Hapi              |
| Container port | `3000`                                          |
| Health probe   | `GET /health` (anonymous, returns `200`)        |

## Required environment variables

| Variable                       | Source                  | Notes                                                          |
| ------------------------------ | ----------------------- | -------------------------------------------------------------- |
| `PORT`                         | Container               | `3000` (matches `EXPOSE`).                                     |
| `NODE_ENV`                     | CDP platform            | `production` in deployed environments.                         |
| `ENVIRONMENT`                  | CDP platform            | One of `infra-dev`/`management`/`dev`/`test`/`perf-test`/`ext-test`/`prod`. |
| `BACKEND_API_URL`              | Service config          | URL of the case-management backend in the same environment.    |
| `BACKEND_API_COGNITO_CLIENT_ID`| Service config          | Sent as `x-cdp-cognito-client-id` to the backend.              |
| `SESSION_CACHE_ENGINE`         | Service config          | `redis` in deployed environments.                              |
| `REDIS_HOST`                   | CDP Redis binding       | ElastiCache hostname.                                          |
| `REDIS_TLS`                    | Service config          | `true` in deployed environments.                               |
| `SESSION_COOKIE_PASSWORD`      | **Secret**              | ≥32 chars, generated per environment.                          |
| `SESSION_COOKIE_SECURE`        | Service config          | `true` in deployed environments.                               |
| `TRACING_HEADER`               | Service config          | Defaults to `x-cdp-request-id`.                                |
| `HTTP_PROXY` / `HTTPS_PROXY`   | CDP platform            | CDP outbound proxy.                                            |
| `ENABLE_SECURE_CONTEXT`        | Service config          | `true` in production (loads CDP CA bundle).                    |
| `AUTH_STUB_ENABLED`            | Service config          | `false` in `prod`, `true` elsewhere until real Cognito wired.  |

## Required secrets (cdp-portal)

- `SESSION_COOKIE_PASSWORD` — random ≥32-char string, distinct per
  environment.
- `COGNITO_CLIENT_SECRET` — once real Cognito auth is wired up (currently
  stubbed in non-prod).

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

## Related

- [docs/authentication.md](./authentication.md)
- [Registrations-353](#) — register the service in the CDP portal (prereq).
