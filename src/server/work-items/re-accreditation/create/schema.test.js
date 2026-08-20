import { describe, expect, test } from 'vitest'

import {
  MATERIAL_OPTIONS,
  TONNAGE_BAND_OPTIONS,
  createReAccreditationSchema,
  joiDetailsToFieldErrors
} from './schema.js'

const validForm = () => ({
  operatorEmail: 'test@defra.gov.uk',
  organisationName: 'Acme Recycling Ltd',
  operatorOrganisationId: '500001',
  operatorApplicationId: 'app-001',
  operatorRegistrationId: 'reg-001',
  siteAddress: {
    line1: '1 Test Way',
    line2: '',
    town: 'Testville',
    postcode: 'AB1 2CD'
  },
  material: 'plastic',
  tonnageBand: '500-5000'
})

describe('#createReAccreditationSchema (RA-127, RA-219)', () => {
  test('accepts a fully populated valid form payload', () => {
    const { error, value } = createReAccreditationSchema.validate(validForm(), {
      abortEarly: false
    })
    expect(error).toBeUndefined()
    expect(value.siteAddress.line2).toBe('')
  })

  /**
   * RA-316. Optional passthrough so the create form can CARRY a charge
   * someone else decides. The coercion is the load-bearing part: an HTML
   * input always posts a string, management-be does not validate this
   * field (passthrough by design), and the duly-making page's formatter
   * returns null for a non-integer — so without `convert: true` the page
   * would render "Not provided" for a charge that was actually supplied,
   * with nothing throwing anywhere.
   */
  describe('RA-316 chargeAmountPence passthrough', () => {
    const validateWith = (form) =>
      createReAccreditationSchema.validate(form, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
      })

    test('coerces the form STRING into an integer', () => {
      const { error, value } = validateWith({
        ...validForm(),
        chargeAmountPence: '327600'
      })
      expect(error).toBeUndefined()
      expect(value.chargeAmountPence).toBe(327600)
      expect(typeof value.chargeAmountPence).toBe('number')
      expect(Number.isInteger(value.chargeAmountPence)).toBe(true)
    })

    test('survives stripUnknown rather than being silently discarded', () => {
      const { value } = validateWith({
        ...validForm(),
        chargeAmountPence: '54600'
      })
      expect(value).toHaveProperty('chargeAmountPence', 54600)
    })

    test('is optional — omitting it is valid and forwards nothing', () => {
      // Absent is a legitimate state: legacy-be drops the field entirely
      // when the tonnage band is unset.
      const { error, value } = validateWith(validForm())
      expect(error).toBeUndefined()
      expect(value).not.toHaveProperty('chargeAmountPence')
    })

    test('accepts a zero charge as a real amount', () => {
      const { error, value } = validateWith({
        ...validForm(),
        chargeAmountPence: '0'
      })
      expect(error).toBeUndefined()
      expect(value.chargeAmountPence).toBe(0)
    })

    test.each([
      ['non-numeric', 'not-a-number'],
      ['fractional pence', '327600.5'],
      ['negative', '-100']
    ])('rejects a %s charge', (_label, chargeAmountPence) => {
      const { error } = validateWith({ ...validForm(), chargeAmountPence })
      expect(error).toBeDefined()
    })

    test.each([54600, 218400, 327600, 396500, 360400])(
      'accepts the real band value %i',
      (pence) => {
        const { error, value } = validateWith({
          ...validForm(),
          chargeAmountPence: String(pence)
        })
        expect(error).toBeUndefined()
        expect(value.chargeAmountPence).toBe(pence)
      }
    )

    test('paymentReference is NOT an inbound field and is stripped', () => {
      // Deliberately dropped: the applicationReference fallback is the
      // primary path, so an override field with no consumer would be
      // surface maintained for nothing.
      const { value } = validateWith({
        ...validForm(),
        paymentReference: 'PAY-001'
      })
      expect(value).not.toHaveProperty('paymentReference')
    })
  })

  test('RA-219: is no longer an inbound field and is stripped from input', () => {
    const form = { ...validForm(), applicationReference: 'RA-123456789' }
    const { error, value } = createReAccreditationSchema.validate(form, {
      abortEarly: false,
      stripUnknown: true
    })
    expect(error).toBeUndefined()
    expect(value).not.toHaveProperty('applicationReference')
  })

  test('trims surrounding whitespace from string fields', () => {
    const form = validForm()
    form.organisationName = '  Trim Me  '
    form.siteAddress.line1 = '  10 Road  '
    const { error, value } = createReAccreditationSchema.validate(form, {
      abortEarly: false
    })
    expect(error).toBeUndefined()
    expect(value.organisationName).toBe('Trim Me')
    expect(value.siteAddress.line1).toBe('10 Road')
  })

  test('rejects an entirely empty payload with a friendly message per field', () => {
    const { error } = createReAccreditationSchema.validate(
      {},
      { abortEarly: false }
    )
    expect(error).toBeDefined()
    const errors = joiDetailsToFieldErrors(error.details)
    expect(errors).not.toHaveProperty('applicationReference')
    expect(errors.operatorEmail).toBe('Enter an email address')
    expect(errors.organisationName).toBe('Enter the organisation name')
    expect(errors.operatorOrganisationId).toBe('Enter the organisation ID')
    expect(errors.operatorApplicationId).toBe(
      'Enter the operator application ID'
    )
    expect(errors.operatorRegistrationId).toBe(
      'Enter the operator registration ID'
    )
    expect(errors.material).toBe('Select a material')
    expect(errors.tonnageBand).toBe('Select a tonnage band')
    expect(errors.siteAddress).toBe('Enter the site address')
  })

  describe('RA-448 operatorOrganisationId / operatorApplicationId / operatorRegistrationId', () => {
    test.each([
      ['', 'Enter the organisation ID'],
      ['12345', 'Organisation ID must be 6 digits'],
      ['1234567', 'Organisation ID must be 6 digits'],
      ['abcdef', 'Organisation ID must be 6 digits']
    ])('rejects operatorOrganisationId = %j with %s', (value, message) => {
      const form = validForm()
      form.operatorOrganisationId = value
      const { error } = createReAccreditationSchema.validate(form, {
        abortEarly: false
      })
      expect(error).toBeDefined()
      const errors = joiDetailsToFieldErrors(error.details)
      expect(errors.operatorOrganisationId).toBe(message)
    })

    test.each(['123456', '000001', '999999'])(
      'accepts a valid 6-digit operatorOrganisationId %j',
      (value) => {
        const form = validForm()
        form.operatorOrganisationId = value
        const { error } = createReAccreditationSchema.validate(form, {
          abortEarly: false
        })
        expect(error).toBeUndefined()
      }
    )

    test('rejects a blank operatorRegistrationId', () => {
      const form = validForm()
      form.operatorRegistrationId = ''
      const { error } = createReAccreditationSchema.validate(form, {
        abortEarly: false
      })
      expect(error).toBeDefined()
      const errors = joiDetailsToFieldErrors(error.details)
      expect(errors.operatorRegistrationId).toBe(
        'Enter the operator registration ID'
      )
    })

    test('rejects a blank operatorApplicationId', () => {
      const form = validForm()
      form.operatorApplicationId = ''
      const { error } = createReAccreditationSchema.validate(form, {
        abortEarly: false
      })
      expect(error).toBeDefined()
      const errors = joiDetailsToFieldErrors(error.details)
      expect(errors.operatorApplicationId).toBe(
        'Enter the operator application ID'
      )
    })
  })

  test.each([
    ['operatorEmail', '', 'Enter an email address'],
    [
      'operatorEmail',
      'not-an-email',
      'Enter an email address in the correct format, like name@example.com'
    ],
    [
      'organisationName',
      'a'.repeat(201),
      'Organisation name must be 200 characters or fewer'
    ],
    ['material', 'gold', 'Select a material from the list'],
    ['tonnageBand', 'huge', 'Select a tonnage band from the list']
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

  test('rejects an email longer than 254 characters with the max message', () => {
    // 60-char local part + '@' + 195-char domain = 256 chars total but
    // syntactically valid, so the `string.max` rule is what fires.
    const form = validForm()
    form.operatorEmail = `${'a'.repeat(60)}@${'b'.repeat(191)}.uk`
    const { error } = createReAccreditationSchema.validate(form, {
      abortEarly: false
    })
    expect(error).toBeDefined()
    const messages = error.details
      .filter((d) => d.path[0] === 'operatorEmail')
      .map((d) => d.message)
    expect(messages).toContain('Email address must be 254 characters or fewer')
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
