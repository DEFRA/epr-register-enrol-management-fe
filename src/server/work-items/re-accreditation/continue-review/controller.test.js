import { beforeEach, describe, expect, test, vi } from 'vitest'

// `vi.hoisted` because `vi.mock` factories are hoisted above module-level
// consts — a plain `const warn = vi.fn()` is still in its TDZ when the
// logger factory runs.
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))

vi.mock('#/server/common/helpers/auth/get-user.js', () => ({
  getUser: vi.fn(() => ({ id: 'u-1', name: 'Alice' }))
}))

vi.mock('#/server/common/helpers/logging/logger.js', () => ({
  createLogger: () => ({ warn, info: vi.fn(), error: vi.fn() })
}))

import { makeContinueReviewController } from './controller.js'

function buildHapi(overrides = {}) {
  const captured = {}
  const h = {
    redirect: vi.fn((to) => {
      captured.redirectTo = to
      return { redirect: to }
    }),
    view: vi.fn()
  }
  const request = {
    params: { id: 'wi-1' },
    payload: {},
    yar: { flash: vi.fn() },
    auth: { credentials: { scope: ['standard'] } },
    ...overrides
  }
  return { request, h, captured }
}

function serviceReturning(result) {
  return { continueReviewOfWorkItem: vi.fn().mockResolvedValue(result) }
}

describe('makeContinueReviewController (RA-372)', () => {
  beforeEach(() => {
    warn.mockReset()
  })

  test('passes the work item id and acting user to the service', async () => {
    const service = serviceReturning({ ok: true, workItem: { id: 'wi-1' } })
    const { request, h } = buildHapi()

    await makeContinueReviewController({ service }).handler(request, h)

    expect(service.continueReviewOfWorkItem).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      user: { id: 'u-1', name: 'Alice' }
    })
  })

  test('redirects to the detail page with a success banner on success', async () => {
    const service = serviceReturning({
      ok: true,
      workItem: { id: 'wi-1', stateId: 'assessment-in-progress' }
    })
    const { request, h, captured } = buildHapi()

    await makeContinueReviewController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
    expect(request.yar.flash).toHaveBeenCalledWith('flashBanner', {
      type: 'success',
      title: 'Review continued',
      text: 'The application has returned to the stage it was queried from. Any outstanding tasks are available to complete.'
    })
    expect(warn).not.toHaveBeenCalled()
  })

  test('percent-encodes the id in the redirect target', async () => {
    const service = serviceReturning({ ok: true, workItem: { id: 'a/b' } })
    const { request, h, captured } = buildHapi({ params: { id: 'a/b' } })

    await makeContinueReviewController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/a%2Fb')
  })

  test.each([
    [
      'conflict',
      'This application can no longer be continued from its current state. Refresh and try again.'
    ],
    ['not-found', 'This application could not be found.'],
    ['server', 'There was a problem continuing this review. Try again.'],
    ['network', 'There was a problem continuing this review. Try again.'],
    ['invalid', 'There was a problem continuing this review. Try again.'],
    ['unauthorized', 'There was a problem continuing this review. Try again.']
  ])(
    'redirects with the %s error banner and logs the outcome',
    async (outcome, text) => {
      const service = serviceReturning({
        ok: false,
        outcome,
        status: 409,
        message: 'engine said no'
      })
      const { request, h, captured } = buildHapi()

      await makeContinueReviewController({ service }).handler(request, h)

      expect(captured.redirectTo).toBe('/work-items/wi-1')
      expect(request.yar.flash).toHaveBeenCalledWith('flashBanner', {
        type: 'error',
        title: 'Could not continue the review',
        text
      })
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ workItemId: 'wi-1', outcome }),
        'Re-accreditation continue review failed'
      )
    }
  )

  test('tolerates a request with no yar session rather than throwing', async () => {
    const service = serviceReturning({ ok: true, workItem: { id: 'wi-1' } })
    const { request, h, captured } = buildHapi({ yar: undefined })

    await makeContinueReviewController({ service }).handler(request, h)

    expect(captured.redirectTo).toBe('/work-items/wi-1')
  })

  test('builds its own service when none is injected', async () => {
    const controller = makeContinueReviewController()
    expect(typeof controller.handler).toBe('function')
  })
})
