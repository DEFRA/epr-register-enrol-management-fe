import { vi } from 'vitest'

import { makePaymentReceivedController } from './controller.js'

const ID = '11111111-1111-1111-1111-111111111111'

function makeRequest(overrides = {}) {
  return {
    params: { id: ID },
    yar: { flash: vi.fn(), get: vi.fn() },
    auth: {
      isAuthenticated: true,
      credentials: { id: 'u-1', name: 'Case Worker', roles: ['standard'] }
    },
    ...overrides
  }
}

function makeToolkit() {
  return { redirect: vi.fn().mockReturnValue('redirected') }
}

describe('#makePaymentReceivedController (RA-523)', () => {
  test('records the payment and PRG-redirects to the detail page', async () => {
    const service = {
      recordPaymentReceived: vi.fn().mockResolvedValue({
        ok: true,
        workItem: { id: ID, stateId: 'assessment-in-progress' }
      })
    }
    const request = makeRequest()
    const h = makeToolkit()

    const response = await makePaymentReceivedController({ service }).handler(
      request,
      h
    )

    expect(service.recordPaymentReceived).toHaveBeenCalledWith({
      workItemId: ID,
      user: expect.objectContaining({ id: 'u-1' })
    })
    // PRG, so a refresh cannot re-post the transition.
    expect(h.redirect).toHaveBeenCalledWith(`/work-items/${ID}`)
    expect(response).toBe('redirected')
  })

  test('the success banner NAMES the destination, because the status tag will not', async () => {
    const service = {
      recordPaymentReceived: vi
        .fn()
        .mockResolvedValue({ ok: true, workItem: {} })
    }
    const request = makeRequest()

    await makePaymentReceivedController({ service }).handler(
      request,
      makeToolkit()
    )

    const [key, banner] = request.yar.flash.mock.calls[0]
    expect(key).toBe('flashBanner')
    expect(banner.type).toBe('success')
    // `assessment-in-progress` and `updated` deliberately share the display
    // name "Updated" (RA-324 AC06), so pressing this button does not visibly
    // change the state tag. The banner is therefore the ONLY feedback that
    // anything happened, and it has to say where the item went.
    expect(banner.text).toContain('assessment')
  })

  test.each([
    ['conflict', 'can no longer be moved on'],
    ['not-found', 'could not be found']
  ])(
    'renders a distinct banner for the %s outcome, and still redirects',
    async (outcome, expectedText) => {
      const service = {
        recordPaymentReceived: vi
          .fn()
          .mockResolvedValue({ ok: false, outcome, status: 409 })
      }
      const request = makeRequest()
      const h = makeToolkit()

      await makePaymentReceivedController({ service }).handler(request, h)

      const [, banner] = request.yar.flash.mock.calls[0]
      expect(banner.type).toBe('error')
      expect(banner.title).toBe('Could not record payment received')
      expect(banner.text).toContain(expectedText)
      // Redirects even on failure: the caller lands on the item and sees
      // the banner there, rather than on a dead-end error page.
      expect(h.redirect).toHaveBeenCalledWith(`/work-items/${ID}`)
    }
  )

  test('falls back to a generic banner for an unexpected outcome', async () => {
    const service = {
      recordPaymentReceived: vi
        .fn()
        .mockResolvedValue({ ok: false, outcome: 'server', status: 500 })
    }
    const request = makeRequest()

    await makePaymentReceivedController({ service }).handler(
      request,
      makeToolkit()
    )

    const [, banner] = request.yar.flash.mock.calls[0]
    expect(banner.type).toBe('error')
    expect(banner.text).toContain('Try again')
  })

  test('survives a request with no session rather than throwing', async () => {
    const service = {
      recordPaymentReceived: vi
        .fn()
        .mockResolvedValue({ ok: true, workItem: {} })
    }
    const h = makeToolkit()

    await expect(
      makePaymentReceivedController({ service }).handler(
        makeRequest({ yar: undefined }),
        h
      )
    ).resolves.toBe('redirected')
  })
})
