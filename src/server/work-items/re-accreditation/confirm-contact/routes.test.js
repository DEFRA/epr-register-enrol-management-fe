import { describe, expect, test } from 'vitest'

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'
import { buildConfirmContactRoutes } from './routes.js'

const PATH = '/work-items/re-accreditation/{id}/confirm-contact'

describe('buildConfirmContactRoutes (RA-527)', () => {
  const routes = buildConfirmContactRoutes()

  test('mounts GET and POST on the same type-namespaced path', () => {
    expect(routes.map((r) => [r.method, r.path])).toEqual([
      ['GET', PATH],
      ['POST', PATH]
    ])
  })

  test('the POST, which applies the determination, requires the standard role', () => {
    const post = routes.find((r) => r.method === 'POST')
    expect(post.options.auth).toEqual(requireStandard.auth)
  })

  test('the GET stays open to a read-only user, who sees the controls disabled', () => {
    const get = routes.find((r) => r.method === 'GET')
    expect(get.options?.auth).toBeUndefined()
  })

  test('the POST accepts only form-encoded bodies, with a size cap', () => {
    const post = routes.find((r) => r.method === 'POST')
    expect(post.options.payload.allow).toBe('application/x-www-form-urlencoded')
    expect(post.options.payload.maxBytes).toBe(10 * 1024)
  })

  test('every route has a handler', () => {
    for (const route of routes) {
      expect(typeof route.handler).toBe('function')
    }
  })
})
