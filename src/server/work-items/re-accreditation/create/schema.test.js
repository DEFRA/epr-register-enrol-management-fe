import { describe, expect, test } from 'vitest'

import {
  MATERIAL_OPTIONS,
  TONNAGE_BAND_OPTIONS,
  createReAccreditationSchema,
  joiDetailsToFieldErrors
} from './schema.js'

const validForm = () => ({
  applicationReference: 'REF-001',
  organisationName: 'Acme Recycling Ltd',
  siteAddress: {
    line1: '1 Test Way',
    line2: '',
    town: 'Testville',
    postcode: 'AB1 2CD'
  },
  material: 'plastic',
  tonnageBand: '500-5000',
  submittedByEmail: 'duly@example.com'
})

describe('#createReAccreditationSchema (RA-127)', () => {
  test('accepts a fully populated valid form payload', () => {
    const { error, value } = createReAccreditationSchema.validate(validForm(), {
      abortEarly: false
    })
    expect(error).toBeUndefined()
    expect(value.applicationReference).toBe('REF-001')
    expect(value.siteAddress.line2).toBe('')
  })

  test('trims surrounding whitespace from string fields', () => {
    const form = validForm()
    form.applicationReference = '  REF-002  '
    form.organisationName = '  Trim Me  '
    form.siteAddress.line1 = '  10 Road  '
    form.submittedByEmail = '  user@example.com  '
    const { error, value } = createReAccreditationSchema.validate(form, {
      abortEarly: false
    })
    expect(error).toBeUndefined()
    expect(value.applicationReference).toBe('REF-002')
    expect(value.organisationName).toBe('Trim Me')
    expect(value.siteAddress.line1).toBe('10 Road')
    expect(value.submittedByEmail).toBe('user@example.com')
  })

  test('rejects an entirely empty payload with a friendly message per field', () => {
    const { error } = createReAccreditationSchema.validate(
      {},
      { abortEarly: false }
    )
    expect(error).toBeDefined()
    const errors = joiDetailsToFieldErrors(error.details)
    expect(errors.applicationReference).toBe('Enter the application reference')
    expect(errors.organisationName).toBe('Enter the organisation name')
    expect(errors.material).toBe('Select a material')
    expect(errors.tonnageBand).toBe('Select a tonnage band')
    expect(errors.submittedByEmail).toBe("Enter the submitter's email address")
    expect(errors.siteAddress).toBe('Enter the site address')
  })

  test.each([
    ['applicationReference', '', 'Enter the application reference'],
    [
      'applicationReference',
      'a'.repeat(51),
      'Application reference must be 50 characters or fewer'
    ],
    [
      'applicationReference',
      'has space!',
      'Application reference can only include letters, numbers and hyphens'
    ],
    [
      'organisationName',
      'a'.repeat(201),
      'Organisation name must be 200 characters or fewer'
    ],
    ['material', 'gold', 'Select a material from the list'],
    ['tonnageBand', 'huge', 'Select a tonnage band from the list'],
    [
      'submittedByEmail',
      'not-an-email',
      'Enter an email address in the correct format'
    ]
  ])('rejects %s = %j with %s', (field, value, message) => {
    const form = validForm()
    form[field] = value
    const { error } = createReAccreditationSchema.validate(form, {
      abortEarly: false
    })
    expect(error).toBeDefined()
    const errors = joiDetailsToFieldErrors(error.details)
    expect(errors[field]).toBe(message)
  })

  test.each([
    ['line1', '', 'Enter the site address line 1'],
    [
      'line1',
      'x'.repeat(101),
      'Address line 1 must be 100 characters or fewer'
    ],
    [
      'line2',
      'x'.repeat(101),
      'Address line 2 must be 100 characters or fewer'
    ],
    ['town', '', 'Enter the town or city'],
    ['town', 'x'.repeat(101), 'Town must be 100 characters or fewer'],
    ['postcode', '', 'Enter the postcode'],
    ['postcode', 'XX', 'Enter a valid UK postcode'],
    ['postcode', 'A'.repeat(11), 'Postcode must be 10 characters or fewer']
  ])('rejects siteAddress.%s = %j with %s', (field, value, message) => {
    const form = validForm()
    form.siteAddress[field] = value
    const { error } = createReAccreditationSchema.validate(form, {
      abortEarly: false
    })
    expect(error).toBeDefined()
    const errors = joiDetailsToFieldErrors(error.details)
    expect(errors[`siteAddress.${field}`]).toBe(message)
  })

  test('material option list is non-empty and exposes value+text', () => {
    expect(MATERIAL_OPTIONS.length).toBeGreaterThan(0)
    for (const opt of MATERIAL_OPTIONS) {
      expect(opt).toHaveProperty('value')
      expect(opt).toHaveProperty('text')
    }
  })

  test('tonnage band option list is non-empty and exposes value+text', () => {
    expect(TONNAGE_BAND_OPTIONS.length).toBeGreaterThan(0)
    for (const opt of TONNAGE_BAND_OPTIONS) {
      expect(opt).toHaveProperty('value')
      expect(opt).toHaveProperty('text')
    }
  })
})

describe('#joiDetailsToFieldErrors', () => {
  test('returns {} for nullish input', () => {
    expect(joiDetailsToFieldErrors(undefined)).toEqual({})
    expect(joiDetailsToFieldErrors(null)).toEqual({})
  })

  test('flattens nested paths with dots and keeps only the first error per field', () => {
    const details = [
      { path: ['siteAddress', 'postcode'], message: 'first' },
      { path: ['siteAddress', 'postcode'], message: 'second' },
      { path: [], message: 'no-path-ignored' }
    ]
    expect(joiDetailsToFieldErrors(details)).toEqual({
      'siteAddress.postcode': 'first'
    })
  })
})
