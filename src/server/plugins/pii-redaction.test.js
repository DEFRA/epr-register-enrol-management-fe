import { describe, test, expect } from 'vitest'

import {
  REDACTED_VALUE,
  redactedReqSerializer,
  piiSerializers
} from './pii-redaction.js'

describe('#redactedReqSerializer', () => {
  test('replaces remoteAddress with the redacted placeholder', () => {
    const stdSerializedReq = {
      id: 'req-1',
      method: 'GET',
      url: '/work-items',
      headers: { 'user-agent': 'test-agent' },
      remoteAddress: '203.0.113.5',
      remotePort: 54321
    }

    const result = redactedReqSerializer(stdSerializedReq)

    expect(result.remoteAddress).toBe(REDACTED_VALUE)
  })

  test('leaves non-PII request fields untouched', () => {
    const stdSerializedReq = {
      id: 'req-1',
      method: 'POST',
      url: '/work-items',
      headers: { 'user-agent': 'test-agent' },
      remoteAddress: '203.0.113.5',
      remotePort: 54321
    }

    const result = redactedReqSerializer(stdSerializedReq)

    expect(result.id).toBe('req-1')
    expect(result.method).toBe('POST')
    expect(result.url).toBe('/work-items')
    expect(result.headers).toEqual({ 'user-agent': 'test-agent' })
    expect(result.remotePort).toBe(54321)
  })
})

describe('#piiSerializers.email', () => {
  test('always returns the redacted placeholder', () => {
    expect(piiSerializers.email('person@example.com')).toBe(REDACTED_VALUE)
  })
})
