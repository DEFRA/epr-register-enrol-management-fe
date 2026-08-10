import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  continueReviewReAccreditation: vi.fn()
}))

const { continueReviewReAccreditation } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

import { createContinueReviewService } from './service.js'

describe('createContinueReviewService (RA-372)', () => {
  test('forwards the work item id and acting user to the backend client', async () => {
    const workItem = { id: 'wi-1', stateId: 'assessment-in-progress' }
    const continueReview = vi.fn().mockResolvedValue({ ok: true, workItem })
    const user = { id: 'u-1', name: 'Alice' }

    const result = await createContinueReviewService({
      continueReview
    }).continueReviewOfWorkItem({ workItemId: 'wi-1', user })

    expect(continueReview).toHaveBeenCalledWith({ workItemId: 'wi-1', user })
    expect(result).toEqual({ ok: true, workItem })
  })

  test('defaults the user to null when the caller omits it', async () => {
    const continueReview = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })

    await createContinueReviewService({
      continueReview
    }).continueReviewOfWorkItem({ workItemId: 'wi-1' })

    expect(continueReview).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      user: null
    })
  })

  test.each([
    ['conflict', 409, 'conflict'],
    ['not-found', 404, 'not-found'],
    ['forbidden', 403, 'forbidden'],
    ['unauthorized', 401, 'unauthorized'],
    ['invalid', 400, 'invalid'],
    ['network', undefined, 'network'],
    ['server', 500, 'server']
  ])(
    'maps the backend reason %s to outcome %s',
    async (reason, status, outcome) => {
      const continueReview = vi.fn().mockResolvedValue({
        ok: false,
        reason,
        status,
        message: 'nope'
      })

      const result = await createContinueReviewService({
        continueReview
      }).continueReviewOfWorkItem({ workItemId: 'wi-1' })

      expect(result).toEqual({ ok: false, outcome, status, message: 'nope' })
    }
  )

  test('falls back to the server outcome for an unrecognised backend reason', async () => {
    const continueReview = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'something-new',
      status: 418,
      message: 'teapot'
    })

    const result = await createContinueReviewService({
      continueReview
    }).continueReviewOfWorkItem({ workItemId: 'wi-1' })

    expect(result).toEqual({
      ok: false,
      outcome: 'server',
      status: 418,
      message: 'teapot'
    })
  })

  test('supplies a default message when the backend result carries none', async () => {
    const continueReview = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'conflict', status: 409 })

    const result = await createContinueReviewService({
      continueReview
    }).continueReviewOfWorkItem({ workItemId: 'wi-1' })

    expect(result.message).toBe('Continue review failed')
  })

  test.each([[''], ['   '], [undefined], [null], [42]])(
    'throws for a blank or non-string work item id (%s)',
    async (workItemId) => {
      const continueReview = vi.fn()

      await expect(
        createContinueReviewService({
          continueReview
        }).continueReviewOfWorkItem({ workItemId })
      ).rejects.toThrow('workItemId must be a non-empty string')

      expect(continueReview).not.toHaveBeenCalled()
    }
  )

  describe('default backend client', () => {
    beforeEach(() => {
      continueReviewReAccreditation.mockReset()
    })

    test('routes through backend-api when no client is injected', async () => {
      const workItem = { id: 'wi-1', stateId: 'duly-made' }
      continueReviewReAccreditation.mockResolvedValue({ ok: true, workItem })
      const user = { id: 'u-1' }

      const result =
        await createContinueReviewService().continueReviewOfWorkItem({
          workItemId: 'wi-1',
          user
        })

      expect(continueReviewReAccreditation).toHaveBeenCalledWith({
        workItemId: 'wi-1',
        user
      })
      expect(result).toEqual({ ok: true, workItem })
    })
  })
})
