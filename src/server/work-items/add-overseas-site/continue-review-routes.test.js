import { describe, expect, test } from 'vitest'

import { buildAddOverseasSiteContinueReviewRoutes } from './continue-review-routes.js'

describe('buildAddOverseasSiteContinueReviewRoutes (RA-698)', () => {
  test('is a single standard-scoped, form-encoded POST', () => {
    const routes = buildAddOverseasSiteContinueReviewRoutes()

    expect(routes).toHaveLength(1)
    const [post] = routes
    expect(post.method).toBe('POST')
    expect(post.path).toBe('/work-items/add-overseas-site/{id}/continue-review')
    expect(post.options.auth.scope).toEqual(['standard'])
    expect(post.options.payload.allow).toBe('application/x-www-form-urlencoded')
    expect(typeof post.handler).toBe('function')
  })
})
