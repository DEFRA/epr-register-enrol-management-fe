import Joi from 'joi'

/**
 * Material options offered by the create-work-item form (RA-127).
 *
 * The set is the demo-friendly minimum; the backend stores the value as
 * an opaque string on the work item payload, so adding a new material
 * here is purely a frontend concern.
 */
export const MATERIAL_OPTIONS = [
  { value: 'aluminium', text: 'Aluminium' },
  { value: 'glass', text: 'Glass' },
  { value: 'paper', text: 'Paper' },
  { value: 'plastic', text: 'Plastic' },
  { value: 'steel', text: 'Steel' },
  { value: 'wood', text: 'Wood' }
]

/**
 * Tonnage band options offered by the create-work-item form (RA-127).
 *
 * `5000-plus` rather than `5000+` so the value flows through query
 * strings, JSON and Mongo without escaping surprises.
 */
export const TONNAGE_BAND_OPTIONS = [
  { value: '0-500', text: '0 to 500 tonnes' },
  { value: '500-5000', text: '500 to 5,000 tonnes' },
  { value: '5000-plus', text: '5,000+ tonnes' }
]

const MATERIAL_VALUES = MATERIAL_OPTIONS.map((o) => o.value)
const TONNAGE_VALUES = TONNAGE_BAND_OPTIONS.map((o) => o.value)

// Permissive UK postcode pattern. The full BS 7666 regex is huge and
// rejects valid edge cases (e.g. `GIR 0AA`); for the demo we only need
// to catch obvious nonsense and let the operator's real address-lookup
// do the strict validation.
const POSTCODE_PATTERN = /^[A-Z0-9 ]{3,10}$/i
const APPLICATION_REFERENCE_PATTERN = /^[A-Za-z0-9-]+$/

/**
 * Joi schema for the create-work-item form (RA-127, re-accreditation type).
 *
 * `abortEarly: false` so the controller can render every field error in
 * one pass via `govukErrorSummary`. `stripUnknown: true` so nothing the
 * user sneaks into the form ends up in the backend payload.
 */
export const createReAccreditationSchema = Joi.object({
  applicationReference: Joi.string()
    .trim()
    .required()
    .max(50)
    .pattern(APPLICATION_REFERENCE_PATTERN)
    .messages({
      'any.required': 'Enter the application reference',
      'string.empty': 'Enter the application reference',
      'string.max': 'Application reference must be 50 characters or fewer',
      'string.pattern.base':
        'Application reference can only include letters, numbers and hyphens'
    }),
  // RA-172: pre-filled, editable email captured against the work item.
  // Joi's built-in email rule is good enough for the demo; the operator's
  // real identity service will do strict checking downstream.
  operatorEmail: Joi.string()
    .trim()
    .required()
    .max(254)
    .email({ tlds: false })
    .messages({
      'any.required': 'Enter an email address',
      'string.empty': 'Enter an email address',
      'string.max': 'Email address must be 254 characters or fewer',
      'string.email':
        'Enter an email address in the correct format, like name@example.com'
    }),
  organisationName: Joi.string().trim().required().max(200).messages({
    'any.required': 'Enter the organisation name',
    'string.empty': 'Enter the organisation name',
    'string.max': 'Organisation name must be 200 characters or fewer'
  }),
  siteAddress: Joi.object({
    line1: Joi.string().trim().required().max(100).messages({
      'any.required': 'Enter the site address line 1',
      'string.empty': 'Enter the site address line 1',
      'string.max': 'Address line 1 must be 100 characters or fewer'
    }),
    line2: Joi.string().trim().allow('').max(100).messages({
      'string.max': 'Address line 2 must be 100 characters or fewer'
    }),
    town: Joi.string().trim().required().max(100).messages({
      'any.required': 'Enter the town or city',
      'string.empty': 'Enter the town or city',
      'string.max': 'Town must be 100 characters or fewer'
    }),
    postcode: Joi.string()
      .trim()
      .required()
      .max(10)
      .pattern(POSTCODE_PATTERN)
      .messages({
        'any.required': 'Enter the postcode',
        'string.empty': 'Enter the postcode',
        'string.max': 'Postcode must be 10 characters or fewer',
        'string.pattern.base': 'Enter a valid UK postcode'
      })
  })
    .required()
    .messages({ 'any.required': 'Enter the site address' }),
  material: Joi.string()
    .trim()
    .required()
    .valid(...MATERIAL_VALUES)
    .messages({
      'any.required': 'Select a material',
      'string.empty': 'Select a material',
      'any.only': 'Select a material from the list'
    }),
  tonnageBand: Joi.string()
    .trim()
    .required()
    .valid(...TONNAGE_VALUES)
    .messages({
      'any.required': 'Select a tonnage band',
      'string.empty': 'Select a tonnage band',
      'any.only': 'Select a tonnage band from the list'
    })
})

/**
 * Map a Joi `ValidationError.details` array into the
 * `{ fieldId: 'message' }` shape the controller / template consume.
 *
 * Nested fields (`siteAddress.line1`) are flattened with dots so they
 * line up with the field ids in the Nunjucks template (which uses the
 * same dotted name as the form field name).
 */
export function joiDetailsToFieldErrors(details) {
  const out = {}
  for (const detail of details ?? []) {
    const path = (detail.path ?? []).join('.')
    if (path && !(path in out)) {
      out[path] = detail.message
    }
  }
  return out
}
