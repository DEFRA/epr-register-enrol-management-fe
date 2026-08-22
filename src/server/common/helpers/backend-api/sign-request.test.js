import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'vitest'

import { signRequestHeaders } from './sign-request.js'

const SECRET = 'test-shared-secret-for-hmac-signing'

describe('signRequestHeaders', () => {
  test('produces the correct HMAC-SHA256 signature for a full header set', () => {
    const headers = {
      'x-cdp-client-id': 'frontend',
      'x-cdp-user-id': 'user-123',
      'x-cdp-user-name': 'Alice Example'
    }
    const timestamp = '2026-05-18T10:00:00Z'
    const nonce = 'abc123def456ghi7'

    const result = signRequestHeaders(headers, {
      sharedSecret: SECRET,
      timestamp,
      nonce
    })

    const expectedPayload = [
      'v3',
      'frontend',
      'user-123',
      'Alice Example',
      '',
      '',
      timestamp,
      nonce
    ].join('\n')
    const expectedSig = createHmac('sha256', SECRET)
      .update(expectedPayload, 'utf8')
      .digest('base64')

    expect(result['x-cdp-auth-timestamp']).toBe(timestamp)
    expect(result['x-cdp-auth-nonce']).toBe(nonce)
    expect(result['x-cdp-auth-signature']).toBe(expectedSig)
    // Hard-coded reference value guards against systematic payload reordering
    // bugs that would change both sides of the dynamic assertion equally.
    // Computed with: printf 'v3\n...' | openssl dgst -sha256 -hmac '...' -binary | base64
    expect(result['x-cdp-auth-signature']).toBe(
      '6hYzUib9X2d4DdQJPKWjtePnCqk4uuPMVD3gdSM12kU='
    )
  })

  test('uses empty strings for absent optional identity fields', () => {
    const headers = { 'x-cdp-client-id': 'frontend' }
    const timestamp = '2026-05-18T10:00:00Z'
    const nonce = 'testnonce'

    const result = signRequestHeaders(headers, {
      sharedSecret: SECRET,
      timestamp,
      nonce
    })

    const expectedPayload = [
      'v3',
      'frontend',
      '',
      '',
      '',
      '',
      timestamp,
      nonce
    ].join('\n')
    const expectedSig = createHmac('sha256', SECRET)
      .update(expectedPayload, 'utf8')
      .digest('base64')

    expect(result['x-cdp-auth-signature']).toBe(expectedSig)
  })

  test('includes role/nation in the signed payload when present (RA-469)', () => {
    // PR review (masante): role/nation must be signed, not just forwarded,
    // or a party able to alter the headers after signing could bypass
    // management-be's AC17 authorization gate while the signature still
    // validates. This proves the two fields actually change the signature.
    const headers = {
      'x-cdp-client-id': 'frontend',
      'x-cdp-user-id': 'user-123',
      'x-cdp-user-name': 'Alice Example',
      'x-cdp-user-role': 'standard',
      'x-cdp-user-nation': 'Wales'
    }
    const timestamp = '2026-05-18T10:00:00Z'
    const nonce = 'abc123def456ghi7'

    const result = signRequestHeaders(headers, {
      sharedSecret: SECRET,
      timestamp,
      nonce
    })

    const expectedPayload = [
      'v3',
      'frontend',
      'user-123',
      'Alice Example',
      'standard',
      'Wales',
      timestamp,
      nonce
    ].join('\n')
    const expectedSig = createHmac('sha256', SECRET)
      .update(expectedPayload, 'utf8')
      .digest('base64')

    expect(result['x-cdp-auth-signature']).toBe(expectedSig)
    // A signature computed without role/nation (the pre-fix payload shape)
    // must NOT match — this is what closes the tampering gap.
    const preFixPayload = [
      'v3',
      'frontend',
      'user-123',
      'Alice Example',
      timestamp,
      nonce
    ].join('\n')
    const preFixSig = createHmac('sha256', SECRET)
      .update(preFixPayload, 'utf8')
      .digest('base64')
    expect(result['x-cdp-auth-signature']).not.toBe(preFixSig)
  })

  test('timestamp is a fresh ISO-8601 UTC instant without milliseconds', () => {
    const before = Date.now()
    const result = signRequestHeaders({}, { sharedSecret: SECRET })
    const after = Date.now()

    expect(result['x-cdp-auth-timestamp']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
    )
    const ts = new Date(result['x-cdp-auth-timestamp']).getTime()
    expect(ts).toBeGreaterThanOrEqual(before - 1000)
    expect(ts).toBeLessThanOrEqual(after + 1000)
  })

  test('nonce is unique per request', () => {
    const r1 = signRequestHeaders({}, { sharedSecret: SECRET })
    const r2 = signRequestHeaders({}, { sharedSecret: SECRET })
    expect(r1['x-cdp-auth-nonce']).not.toBe(r2['x-cdp-auth-nonce'])
  })

  test('nonce is base64url encoded (no +, / or = characters)', () => {
    for (let i = 0; i < 20; i++) {
      const { 'x-cdp-auth-nonce': nonce } = signRequestHeaders(
        {},
        { sharedSecret: SECRET }
      )
      expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  test('returns empty object when shared secret is not configured', () => {
    const result = signRequestHeaders(
      { 'x-cdp-client-id': 'frontend' },
      { sharedSecret: '' }
    )
    expect(result).toEqual({})
  })
})
