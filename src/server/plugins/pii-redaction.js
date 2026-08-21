export const REDACTED_VALUE = '[REDACTED]'

/**
 * Wraps pino's standard request serializer output and redacts the client IP.
 * hapi-pino passes the already-std-serialized req object here (it wraps
 * whatever we register as `serializers.req` with `wrapRequestSerializer`),
 * so `req.remoteAddress` is a plain string at this point, not a connection.
 */
export function redactedReqSerializer(req) {
  return {
    ...req,
    remoteAddress: REDACTED_VALUE
  }
}

// Registered by key so any future `logger.info({ email }, ...)` call site
// has its email value redacted automatically. No equivalent for personal
// name: PRODUCTION_LOG_REDACT_PATHS already removes the x-cdp-user-name
// header entirely, and there is no other current call site logging one.
export const piiSerializers = {
  req: redactedReqSerializer,
  email: () => REDACTED_VALUE
}
