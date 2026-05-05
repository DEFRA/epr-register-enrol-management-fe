import { describe, expect, test } from 'vitest'
import { pino } from 'pino'

import { PRODUCTION_LOG_REDACT_PATHS } from '#/config/config.js'

describe('production log redaction (epr-zld)', () => {
  test('PRODUCTION_LOG_REDACT_PATHS includes the user identity headers', () => {
    expect(PRODUCTION_LOG_REDACT_PATHS).toContain(
      'req.headers["x-cdp-user-id"]'
    )
    expect(PRODUCTION_LOG_REDACT_PATHS).toContain(
      'req.headers["x-cdp-user-name"]'
    )
  })

  test('Pino strips the x-cdp-user-* headers from serialized output', () => {
    const chunks = []
    const stream = { write: (c) => chunks.push(c) }

    const logger = pino(
      {
        redact: { paths: PRODUCTION_LOG_REDACT_PATHS, remove: true }
      },
      stream
    )

    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer secret',
            cookie: 'session=abc',
            'x-cdp-user-id': 'u-1',
            'x-cdp-user-name': 'Alice Example',
            'x-cdp-user-roles': 'standard,case-worker',
            'x-cdp-request-id': 'trace-123'
          }
        }
      },
      'incoming request'
    )

    const out = JSON.parse(chunks[0])
    expect(out.req.headers).not.toHaveProperty('x-cdp-user-id')
    expect(out.req.headers).not.toHaveProperty('x-cdp-user-name')
    expect(out.req.headers).not.toHaveProperty('authorization')
    expect(out.req.headers).not.toHaveProperty('cookie')
    // Non-sensitive headers (roles list, trace id) are preserved.
    expect(out.req.headers['x-cdp-user-roles']).toBe('standard,case-worker')
    expect(out.req.headers['x-cdp-request-id']).toBe('trace-123')
  })
})
