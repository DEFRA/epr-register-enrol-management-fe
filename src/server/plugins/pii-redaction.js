export const REDACTED_VALUE = '[REDACTED]'

// Header names that can carry the real client IP when the app sits behind
// a reverse proxy/load balancer (this platform's local dev stack fronts
// every service with nginx-proxy, which sets these by default) - the
// process-level remoteAddress is then just the proxy's own address, so
// these headers are the field that actually needs redacting.
const FORWARDED_IP_HEADERS = ['x-forwarded-for', 'x-real-ip']

function redactForwardedIpHeaders(headers) {
  if (headers == null) {
    return headers
  }
  const redacted = { ...headers }
  for (const header of FORWARDED_IP_HEADERS) {
    if (header in redacted) {
      redacted[header] = REDACTED_VALUE
    }
  }
  return redacted
}

/**
 * Wraps pino's standard request serializer output and redacts the client IP.
 * hapi-pino passes the already-std-serialized req object here (it wraps
 * whatever we register as `serializers.req` with `wrapRequestSerializer`),
 * so `req.remoteAddress` is a plain string at this point, not a connection.
 *
 * This guarantee only holds via the hapi-pino-wrapped path (registered in
 * request-logger.js). The bare `pino(loggerOptions)` instance exported by
 * logger.js's `createLogger()` does NOT get this wrapping, so a future
 * `createLogger().info({ req: rawRequest }, ...)` call would receive an
 * unserialized req and this function's redaction couldn't be relied on
 * for it. No current call site does this.
 */
export function redactedReqSerializer(req) {
  return {
    ...req,
    remoteAddress: REDACTED_VALUE,
    headers: redactForwardedIpHeaders(req.headers)
  }
}

// Registered by key so any future `logger.info({ email }, ...)` call site
// has its email value redacted automatically. No equivalent for personal
// name: PRODUCTION_LOG_REDACT_PATHS already removes the x-cdp-user-name
// header in production, and there is no other current call site logging
// one - note that redaction is production-only there (empty in dev/test),
// unlike this file's IP/email redaction, which applies in every environment.
export const piiSerializers = {
  req: redactedReqSerializer,
  email: () => REDACTED_VALUE
}
