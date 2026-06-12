import { describe, expect, test, vi } from 'vitest'

import { createReAccreditationService } from './service.js'

const validForm = () => ({
  operatorEmail: 'test@defra.gov.uk',
  organisationName: 'Acme',
  siteAddress: {
    line1: '1 Test Way',
    line2: '',
    town: 'Testville',
    postcode: 'AB1 2CD'
  },
  material: 'plastic',
  tonnageBand: '500-5000'
})

describe('#createReAccreditationService.create (RA-127, RA-219)', () => {
  test('returns invalid + fieldErrors when Joi rejects the payload', async () => {
    const createWorkItem = vi.fn()
    const service = createReAccreditationService({ createWorkItem })

    const result = await service.create({
      formValues: { operatorEmail: '' },
      user: { id: 'u-1' }
    })

    expect(createWorkItem).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid')
    expect(result.fieldErrors.operatorEmail).toBe('Enter an email address')
    expect(result.values).toEqual({ operatorEmail: '' })
  })

  test('forwards a clean payload to the backend client, never sends a reference, and returns the backend-generated reference', async () => {
    const workItem = {
      id: 'wi-123',
      typeId: 're-accreditation',
      payload: { applicationReference: 'RA-987654321' }
    }
    const createWorkItem = vi.fn().mockResolvedValue({ ok: true, workItem })
    const service = createReAccreditationService({ createWorkItem })

    const formValues = validForm()
    const result = await service.create({
      formValues,
      user: { id: 'u-1' }
    })

    expect(createWorkItem).toHaveBeenCalledTimes(1)
    const call = createWorkItem.mock.calls[0][0]
    expect(call.typeId).toBe('re-accreditation')
    expect(call.user).toEqual({ id: 'u-1' })
    // RA-219: the BFF never sends an application reference to the backend.
    expect(call).not.toHaveProperty('applicationReference')
    expect(call.payload).not.toHaveProperty('applicationReference')
    expect(call.payload.operatorEmail).toBe('test@defra.gov.uk')
    expect(call.payload.siteAddress.postcode).toBe('AB1 2CD')

    // The reference comes back from the created work item's payload.
    expect(result).toEqual({
      ok: true,
      workItem,
      applicationReference: 'RA-987654321'
    })
  })

  test('returns an undefined reference when the backend response omits the payload', async () => {
    const createWorkItem = vi
      .fn()
      .mockResolvedValue({ ok: true, workItem: { id: 'wi-1' } })
    const service = createReAccreditationService({ createWorkItem })

    const result = await service.create({
      formValues: validForm(),
      user: null
    })

    expect(result.ok).toBe(true)
    expect(result.applicationReference).toBeUndefined()
  })

  test('passes backend invalid result through and re-attaches the form values', async () => {
    const createWorkItem = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'invalid',
      status: 400,
      message: 'Backend said no'
    })
    const service = createReAccreditationService({ createWorkItem })
    const formValues = validForm()

    const result = await service.create({ formValues, user: null })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid')
    expect(result.message).toBe('Backend said no')
    expect(result.values).toBe(formValues)
  })

  test('passes backend server failure through with the form values', async () => {
    const createWorkItem = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'server',
      status: 503,
      message: 'down'
    })
    const service = createReAccreditationService({ createWorkItem })
    const formValues = validForm()

    const result = await service.create({ formValues, user: null })

    expect(result).toMatchObject({
      ok: false,
      reason: 'server',
      status: 503,
      message: 'down',
      values: formValues
    })
  })

  test('uses the default backend client when none is injected', () => {
    const service = createReAccreditationService()
    expect(typeof service.create).toBe('function')
  })

  test('handles being called with no formValues at all', async () => {
    const createWorkItem = vi.fn()
    const service = createReAccreditationService({ createWorkItem })
    const result = await service.create({ user: null })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid')
    expect(result.values).toEqual({})
  })
})
