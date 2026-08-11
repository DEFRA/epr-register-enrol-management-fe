import { describe, expect, test } from 'vitest'

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'
import { buildDulyMakingRoutes } from './routes.js'

const PATH = '/work-items/re-accreditation/{id}/duly-make'

describe('buildDulyMakingRoutes', () => {
  const routes = buildDulyMakingRoutes()

  test('mounts GET and POST on the same type-namespaced path', () => {
    // Namespaced under `/work-items/re-accreditation/` because this page is
    // type-specific — the generic `/work-items/{id}/...` namespace belongs
    // to the framework's cross-type routes.
    expect(routes.map((r) => [r.method, r.path])).toEqual([
      ['GET', PATH],
      ['POST', PATH]
    ])
  })

  test('both routes are authenticated', () => {
    // `requireStandard` mirrors the backend: any authenticated case
    // worker may duly make. There is deliberately no `assign` gate —
    // management-be does not use 403 on this endpoint at all, so a
    // UI-only role check would block legitimate users while enforcing
    // nothing.
    for (const route of routes) {
      expect(route.options.auth).toEqual(requireStandard.auth)
    }
  })

  test('the POST accepts only form-encoded bodies, with a size cap', () => {
    const post = routes.find((r) => r.method === 'POST')
    expect(post.options.payload.allow).toBe('application/x-www-form-urlencoded')
    expect(post.options.payload.maxBytes).toBeLessThanOrEqual(10 * 1024)
  })

  test('every route has a handler', () => {
    for (const route of routes) {
      expect(typeof route.handler).toBe('function')
    }
  })
})
