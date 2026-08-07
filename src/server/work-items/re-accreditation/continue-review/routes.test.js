import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi
} from 'vitest'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  approveReAccreditation: vi.fn(),
  continueReviewReAccreditation: vi.fn()
}))

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

import { buildContinueReviewRoutes } from './routes.js'

const { continueReviewReAccreditation } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '11111111-1111-1111-1111-111111111111'

describe('buildContinueReviewRoutes (RA-372)', () => {
  test('returns a single POST at /work-items/re-accreditation/{id}/continue-review, auth-scoped to standard', () => {
    const routes = buildContinueReviewRoutes()

    // POST only — the CTA posts straight through, there is no
    // interstitial to GET.
    expect(routes).toHaveLength(1)

    const [post] = routes
    expect(post.method).toBe('POST')
    expect(post.path).toBe('/work-items/re-accreditation/{id}/continue-review')
    // Mirrors the backend, which protects the endpoint with plain
    // `.RequireAuthorization()` — no `assign` role, no assigned-officer
    // check.
    expect(post.options.auth.scope).toEqual(['standard'])
    expect(post.options.payload).toEqual({
      parse: true,
      allow: 'application/x-www-form-urlencoded',
      maxBytes: 10 * 1024
    })
    expect(typeof post.handler).toBe('function')
  })
})

describe('POST /work-items/re-accreditation/{id}/continue-review', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    continueReviewReAccreditation.mockReset()
  })

  test('calls the backend with the acting user and PRG-redirects to the detail page', async () => {
    continueReviewReAccreditation.mockResolvedValue({
      ok: true,
      workItem: { id: ID, stateId: 'assessment-in-progress' }
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/re-accreditation/${ID}/continue-review`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(continueReviewReAccreditation).toHaveBeenCalledWith({
      workItemId: ID,
      user: expect.objectContaining({ id: expect.any(String) })
    })
  })

  test('still redirects to the detail page when the backend rejects the transition', async () => {
    continueReviewReAccreditation.mockResolvedValue({
      ok: false,
      reason: 'conflict',
      status: 409,
      message: 'Could not continue re-accreditation review'
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/re-accreditation/${ID}/continue-review`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    // Post/Redirect/Get in every branch, so a refresh never re-posts.
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
  })

  test('is rejected without a CSRF crumb', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: `/work-items/re-accreditation/${ID}/continue-review`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(continueReviewReAccreditation).not.toHaveBeenCalled()
  })

  // RA-335. The CTA renders disabled for a read-only support user, but the
  // scope check is the real gate: a forged POST must not reach the handler.
  test('is rejected with 403 for a read-only support user', async () => {
    const { statusCode } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/re-accreditation/${ID}/continue-review`,
      payload: '',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-test-user-role': 'support-readonly'
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(continueReviewReAccreditation).not.toHaveBeenCalled()
  })
})
