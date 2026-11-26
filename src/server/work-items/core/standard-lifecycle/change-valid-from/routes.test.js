import { describe, expect, test } from 'vitest'

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'
import { buildChangeValidFromRoutes } from './routes.js'

const PATH = '/work-items/add-overseas-site/{id}/change-valid-from'

describe('buildChangeValidFromRoutes', () => {
  const routes = buildChangeValidFromRoutes('add-overseas-site')

  test('mounts GET and POST on the same type-namespaced path', () => {
    expect(routes.map((r) => [r.method, r.path])).toEqual([
      ['GET', PATH],
      ['POST', PATH]
    ])
  })

  test('both routes are authenticated as a standard user', () => {
    for (const route of routes) {
      expect(route.options.auth).toEqual(requireStandard.auth)
    }
  })

  test('the POST accepts only form-encoded bodies, with a size cap', () => {
    const post = routes.find((r) => r.method === 'POST')
    expect(post.options.payload.allow).toBe('application/x-www-form-urlencoded')
    expect(post.options.payload.maxBytes).toBeGreaterThan(0)
  })

  test('every route has a handler', () => {
    for (const route of routes) {
      expect(typeof route.handler).toBe('function')
    }
  })
})
