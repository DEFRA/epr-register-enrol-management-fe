/**
 * Validation for the "Query an application" form (RA-291).
 *
 * Server-side validation is mandatory: `govukCharacterCount` only shows
 * a live count in the browser, it does not block submission, and the
 * page must work with JavaScript disabled anyway (RA-94).
 */

import Joi from 'joi'

import { countWords } from '#/server/common/helpers/word-count.js'

/**
 * The six queryable areas of a re-accreditation application. The `value`
 * is the contract with the backend — it is sent verbatim in the
 * `sections` array and must stay in lock-step with the backend enum.
 */
export const QUERY_SECTION_OPTIONS = [
  { value: 'authority-to-issue', text: 'Authority to issue' },
  { value: 'business-plan', text: 'Business plan' },
  { value: 'prn-tonnage', text: 'PRN tonnage' },
  {
    value: 'sampling-and-inspection-plan',
    text: 'Sampling and inspection plan'
  },
  {
    value: 'broadly-equivalent-standards',
    text: 'Broadly equivalent standards (BES)'
  },
  {
    value: 'overseas-reprocessing-sites',
    text: 'Overseas reprocessing sites (ORS)'
  }
]

export const QUERY_SECTION_VALUES = QUERY_SECTION_OPTIONS.map((o) => o.value)

/** AC07/AC08 — the reason is capped in *words*, not characters. */
export const QUERY_REASON_MAX_WORDS = 200

export const SELECT_SECTIONS_MESSAGE = 'Select which areas you want to query'
export const ENTER_REASON_MESSAGE = 'Enter a reason for the query'
export const REASON_TOO_LONG_MESSAGE = `Query must be ${QUERY_REASON_MAX_WORDS} words or fewer`

/**
 * A checkbox group posts a bare string when one box is ticked and an
 * array when several are, and nothing at all when none are. Normalise
 * defensively so the schema only ever sees an array of strings.
 */
export function normaliseSections(raw) {
  if (typeof raw === 'string') {
    return raw === '' ? [] : [raw]
  }
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === 'string' && v !== '')
  }
  return []
}

const withinWordLimit = (value, helpers) =>
  countWords(value) > QUERY_REASON_MAX_WORDS
    ? helpers.error('string.maxWords')
    : value

export const queryFormSchema = Joi.object({
  sections: Joi.array()
    .items(Joi.string().valid(...QUERY_SECTION_VALUES))
    .min(1)
    .required()
    .messages({
      'any.required': SELECT_SECTIONS_MESSAGE,
      'array.base': SELECT_SECTIONS_MESSAGE,
      'array.min': SELECT_SECTIONS_MESSAGE,
      'array.includes': SELECT_SECTIONS_MESSAGE,
      'any.only': SELECT_SECTIONS_MESSAGE
    }),
  reason: Joi.string().trim().required().custom(withinWordLimit).messages({
    'any.required': ENTER_REASON_MESSAGE,
    'string.base': ENTER_REASON_MESSAGE,
    'string.empty': ENTER_REASON_MESSAGE,
    'string.maxWords': REASON_TOO_LONG_MESSAGE
  })
})

/**
 * Flatten Joi details into the `{ field: message }` shape the template
 * consumes. First error per field wins, matching the create form.
 */
export function joiDetailsToFieldErrors(details) {
  const out = {}
  for (const detail of details ?? []) {
    const path = (detail.path ?? []).join('.')
    const field = path.split('.')[0]
    if (field && !(field in out)) {
      out[field] = detail.message
    }
  }
  return out
}

const FIELD_ORDER = ['sections', 'reason']

/**
 * Build a `govukErrorSummary` model. Anchors are `#field-<name>`, which
 * match the component ids used in `query.njk`.
 */
export function buildErrorSummary(fieldErrors) {
  const items = []
  for (const field of FIELD_ORDER) {
    if (fieldErrors[field]) {
      items.push({ text: fieldErrors[field], href: `#field-${field}` })
    }
  }
  return items.length === 0 ? null : { titleText: 'There is a problem', items }
}

/**
 * Validate a raw Hapi payload.
 *
 * @returns {{ ok: true, value: { sections: string[], reason: string } }
 *          | { ok: false, fieldErrors: Record<string,string>,
 *              values: { sections: string[], reason: string } }}
 */
export function validateQueryForm(payload) {
  const sections = normaliseSections(payload?.sections)
  const rawReason = typeof payload?.reason === 'string' ? payload.reason : ''
  const values = { sections, reason: rawReason }

  const { error, value } = queryFormSchema.validate(
    { sections, reason: rawReason },
    { abortEarly: false, stripUnknown: true }
  )

  if (error) {
    return {
      ok: false,
      fieldErrors: joiDetailsToFieldErrors(error.details),
      values
    }
  }

  return { ok: true, value }
}
