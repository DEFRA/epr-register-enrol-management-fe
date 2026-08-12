import { describe, expect, test } from 'vitest'

import { requireStandard } from '#/server/common/helpers/auth/auth-scopes.js'
import { buildDecisionRoutes } from './routes.js'

const PATH = '/work-items/re-accreditation/{id}/decision'

describe('buildDecisionRoutes', () => {
  const routes = buildDecisionRoutes()

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
    // `requireStandard` mirrors the backend: any authenticated case worker
    // may log a decision (RA-323 removed the decision-maker role tier), and
    // management-be returns no 403 on this endpoint at all. It is still the
    // enforcement point that keeps an RA-335 read-only support session out,
    // since such a session never holds ROLE_STANDARD.
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
