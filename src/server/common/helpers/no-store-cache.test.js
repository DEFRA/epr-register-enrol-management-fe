import { describe, expect, test, vi } from 'vitest'

import { noStoreAuthenticatedResponses } from './no-store-cache.js'

const h = { continue: Symbol('continue') }

function makeResponse() {
  const headers = {}
  return {
    headers,
    header: vi.fn((key, value) => {
      headers[key] = value
    })
  }
}

function makeBoomResponse() {
  return { isBoom: true, output: { statusCode: 401, headers: {} } }
}

describe('noStoreAuthenticatedResponses', () => {
  test('sets no-store on an authenticated response', () => {
    const response = makeResponse()
    const request = { auth: { isAuthenticated: true }, response }

    expect(noStoreAuthenticatedResponses(request, h)).toBe(h.continue)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers.pragma).toBe('no-cache')
    expect(response.headers.expires).toBe('0')
  })

  test('leaves an unauthenticated response untouched', () => {
    const response = makeResponse()
    const request = { auth: { isAuthenticated: false }, response }

    expect(noStoreAuthenticatedResponses(request, h)).toBe(h.continue)
    expect(response.header).not.toHaveBeenCalled()
    expect(response.headers).toEqual({})
  })

  test('tolerates a request with no auth object at all', () => {
    const response = makeResponse()

    expect(noStoreAuthenticatedResponses({ response }, h)).toBe(h.continue)
    expect(response.header).not.toHaveBeenCalled()
  })

  test('writes to output.headers for a Boom response', () => {
    const response = makeBoomResponse()
    const request = { auth: { isAuthenticated: true }, response }

    expect(noStoreAuthenticatedResponses(request, h)).toBe(h.continue)
    expect(response.output.headers).toEqual({
      'cache-control': 'no-store',
      pragma: 'no-cache',
      expires: '0'
    })
  })

  test('is a no-op when the response cannot carry headers', () => {
    const request = { auth: { isAuthenticated: true }, response: null }

    expect(noStoreAuthenticatedResponses(request, h)).toBe(h.continue)
  })
})
