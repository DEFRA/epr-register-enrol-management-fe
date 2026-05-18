import { describe, expect, test } from 'vitest'

import { buildApprovalRoutes } from './routes.js'

describe('buildApprovalRoutes', () => {
  test('returns a GET and POST at /work-items/re-accreditation/{id}/approve, both auth-scoped', () => {
    const routes = buildApprovalRoutes()

    expect(routes).toHaveLength(2)

    const get = routes.find((r) => r.method === 'GET')
    expect(get).toBeDefined()
    expect(get.path).toBe('/work-items/re-accreditation/{id}/approve')
    expect(get.options.auth.scope).toEqual(['standard'])
    expect(typeof get.handler).toBe('function')

    const post = routes.find((r) => r.method === 'POST')
    expect(post).toBeDefined()
    expect(post.path).toBe('/work-items/re-accreditation/{id}/approve')
    expect(post.options.auth.scope).toEqual(['standard'])
    expect(post.options.payload).toEqual({
      parse: true,
      allow: 'application/x-www-form-urlencoded',
      maxBytes: 10 * 1024
    })
    expect(typeof post.handler).toBe('function')
  })
})
