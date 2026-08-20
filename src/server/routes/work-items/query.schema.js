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
    text: 'Broadly equivalent standards (BES)',
    // RA-367: BES and ORS are exporter-only. A reprocessor's operator app
    // has no such sections to unlock, so querying them is meaningless and
    // blocks the query from reaching the operator. This one flag is the
    // shared source of truth for both the controller's checkbox filter and
    // the server-side guard against a crafted POST.
    exporterOnly: true
  },
  {
    value: 'overseas-reprocessing-sites',
    text: 'Overseas reprocessing sites (ORS)',
    exporterOnly: true
  }
]

export const QUERY_SECTION_VALUES = QUERY_SECTION_OPTIONS.map((o) => o.value)

/** RA-367: section values that only apply to exporter applications. */
export const EXPORTER_ONLY_SECTION_VALUES = QUERY_SECTION_OPTIONS.filter(
  (o) => o.exporterOnly
).map((o) => o.value)

/**
 * RA-367 — the section values permitted for a work item, given whether it
 * is an exporter application. Exporter-only sections (BES/ORS) are dropped
 * for non-exporters. Shared by the controller (to filter the rendered
 * checkboxes) and the validator (to reject a crafted POST).
 */
export function allowedSectionValues(isExporter) {
  return QUERY_SECTION_OPTIONS.filter((o) => isExporter || !o.exporterOnly).map(
    (o) => o.value
  )
}

/** AC07/AC08 — the reason is capped in *words*, not characters. */
export const QUERY_REASON_MAX_WORDS = 200

export const SELECT_SECTIONS_MESSAGE = 'Select which areas you want to query'
/**
 * RA-367 — shown when a non-exporter POST includes an exporter-only
 * section (BES/ORS). Anchors to `#field-sections`, same as the other
 * sections errors, so the error summary shape is unchanged.
 */
export const INVALID_SECTIONS_MESSAGE = 'Select which areas you want to query'
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
 * @param {*} payload - the raw Hapi payload.
 * @param {object} [options]
 * @param {boolean} [options.isExporter=true] - RA-367: when false, the
 *   exporter-only sections (BES/ORS) are rejected as invalid. Defaults to
 *   true so callers that do not know the work item type keep the historic
 *   "all six valid" behaviour; the query controller always passes the real
 *   flag derived from the work item.
 * @param {boolean} [options.enforceExporterOnly=true] - RA-367: gates the
 *   exporter-only section guard. The controller passes `false` when the work
 *   item lookup failed, so the request falls through to the backend (which
 *   owns the not-found / network error banner) instead of being rejected with
 *   a misleading sections error on a type we could not actually determine.
 * @returns {{ ok: true, value: { sections: string[], reason: string } }
 *          | { ok: false, fieldErrors: Record<string,string>,
 *              values: { sections: string[], reason: string } }}
 */
export function validateQueryForm(
  payload,
  { isExporter = true, enforceExporterOnly = true } = {}
) {
  const sections = normaliseSections(payload?.sections)
  const rawReason = typeof payload?.reason === 'string' ? payload.reason : ''
  const values = { sections, reason: rawReason }

  const { error, value } = queryFormSchema.validate(
    { sections, reason: rawReason },
    { abortEarly: false, stripUnknown: true }
  )

  const fieldErrors = error ? joiDetailsToFieldErrors(error.details) : {}

  // RA-367 AC3: exporter-only sections are invalid for a non-exporter work
  // item. Only raise this when Joi did not already flag `sections`, so the
  // first-error-per-field contract holds.
  if (enforceExporterOnly && !isExporter && !fieldErrors.sections) {
    const hasExporterOnly = sections.some((v) =>
      EXPORTER_ONLY_SECTION_VALUES.includes(v)
    )
    if (hasExporterOnly) {
      fieldErrors.sections = INVALID_SECTIONS_MESSAGE
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors, values }
  }

  return { ok: true, value }
}
