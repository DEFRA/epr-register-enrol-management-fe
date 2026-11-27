import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getDulyMakeDetails: vi.fn()
}))

const { getDulyMakeDetails } =
  await import('#/server/common/helpers/backend-api/backend-api.js')
const { loadDulyMakeDetails } = await import('./related-work-items.js')
const { clearWorkItemRegistry, registerWorkItemType } =
  await import('../../registry.js')

const ID = 'w-1'

function load(typeId) {
  return loadDulyMakeDetails({ typeId, workItemId: ID, user: null })
}

// RA-782. management-be's `takesPaymentDate` decides; the type's
// `standardLifecycle.paymentDate` is the fallback.
describe('loadDulyMakeDetails', () => {
  beforeEach(() => {
    getDulyMakeDetails.mockReset()
    registerWorkItemType({
      id: 'listed',
      standardLifecycle: { relatedWorkItems: true, paymentDate: false }
    })
    registerWorkItemType({
      id: 'unlisted',
      standardLifecycle: { paymentDate: false }
    })
  })

  afterEach(() => {
    clearWorkItemRegistry()
  })

  test('reads nothing for a type that lists no related work items, and uses its own payment date flag', async () => {
    await expect(load('unlisted')).resolves.toEqual({
      relatedWorkItems: null,
      takesPaymentDate: false
    })
    expect(getDulyMakeDetails).not.toHaveBeenCalled()
  })

  test("uses management-be's takesPaymentDate over the type's", async () => {
    getDulyMakeDetails.mockResolvedValue({
      ok: true,
      details: { takesPaymentDate: true, relatedWorkItems: [{ id: ID }] }
    })
    await expect(load('listed')).resolves.toEqual({
      relatedWorkItems: { rows: [] },
      takesPaymentDate: true
    })
  })

  test("falls back to the type's flag when management-be does not say", async () => {
    getDulyMakeDetails.mockResolvedValue({ ok: true, details: null })
    await expect(load('listed')).resolves.toEqual({
      relatedWorkItems: { rows: [] },
      takesPaymentDate: false
    })
  })

  test("falls back to the type's flag when the read fails", async () => {
    getDulyMakeDetails.mockResolvedValue(undefined)
    await expect(load('listed')).resolves.toEqual({
      relatedWorkItems: { unavailable: true },
      takesPaymentDate: false
    })
  })
})
