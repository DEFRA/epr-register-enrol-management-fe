import { vi } from 'vitest'
import { performAddOverseasSiteOperation } from '#/server/common/helpers/backend-api/backend-api.js'
import { config } from '#/config/config.js'

describe('Add ORS authenticated module transport', () => {
  afterEach(() => config.reset('backendApi.sharedSecret'))

  test.each(['start-assessment', 'refuse', 'approve'])(
    'sends %s to the module boundary with a signed caseworker role',
    async (operation) => {
      config.set('backendApi.sharedSecret', 'test-add-ors-secret')
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stateId: 'rejected' })
      })
      const result = await performAddOverseasSiteOperation({
        workItemId: 'case-1',
        operation,
        user: { id: 'caseworker-1', roles: ['standard'] },
        baseUrl: 'http://management.test/',
        fetchImpl
      })
      expect(result).toEqual({ ok: true, workItem: { stateId: 'rejected' } })
      const [url, init] = fetchImpl.mock.calls[0]
      expect(url).toBe(
        `http://management.test/work-items/add-overseas-site/case-1/${operation}`
      )
      expect(init.method).toBe('POST')
      expect(init.headers['x-cdp-user-id']).toBe('caseworker-1')
      expect(init.headers['x-cdp-user-role']).toBe('standard')
      expect(init.headers['x-cdp-auth-signature']).toBeTruthy()
    }
  )

  test('unconfirmed outcome delivery is returned as a failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Delivery unconfirmed' })
    })
    const result = await performAddOverseasSiteOperation({
      workItemId: 'case-1',
      operation: 'refuse',
      fetchImpl
    })
    expect(result).toEqual({
      ok: false,
      status: 503,
      problem: { detail: 'Delivery unconfirmed' }
    })
  })
})
