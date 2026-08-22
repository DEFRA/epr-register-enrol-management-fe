/**
 * Recycling operation codes: labels, material-type applicability, and
 * validation for the Recycling operations edit form (RA-469).
 *
 * Mirrors epr-register-enrol-frontend's
 * src/server/accreditation/add-overseas-site/recycling-operation-details/controller.js
 * (`CODES_BY_MATERIAL_TYPE`, `requiresAccompanyingCode`) and
 * epr-register-enrol-backend's Utils/RecyclingOperationCodes.cs — kept in
 * sync manually, there is no shared package between the repos. Also mirrors
 * this repo's own `query.schema.js` shape (normalise → Joi → custom checks →
 * buildErrorSummary), since both are GOV.UK checkbox-group forms that must
 * work with JavaScript disabled (RA-94).
 */

import Joi from 'joi'

/** The full code set an overseas site can carry, regardless of material type. */
export const ALL_CODES = ['R3', 'R4', 'R5', 'R12', 'R13']

/**
 * Human-readable labels, verbatim from the operator frontend's
 * `translation.json` (`pages.addOverseasSite.recyclingOperationDetails.operations`)
 * so a regulator sees the same wording an operator saw when setting the code.
 */
export const RECYCLING_OPERATION_LABELS = {
  R3: 'R3 — Recycling/reclamation of organic substances not used as solvents (Includes paper, cardboard, wood, plastics, textiles, composting, anaerobic digestion, and other biological processes)',
  R4: 'R4 — Recycling/reclamation of metals and metal compounds (Scrap metal recycling, metal recovery)',
  R5: 'R5 — Recycling/reclamation of other inorganic materials (Glass, bricks, concrete, soil, aggregates, ceramics)',
  R12: 'R12 — Exchange of waste for submission (sorting, baling, aggregation)',
  R13: 'R13 — Interim storage of wastes'
}

export function recyclingOperationLabel(code) {
  return RECYCLING_OPERATION_LABELS[code] ?? code
}

/**
 * Which of the five codes a site may carry, keyed on the LOWERCASE material
 * token stored on `payload.material` (see `core/materials.js`) — not the
 * operator frontend's Titlecase `MaterialType` enum name.
 */
export const CODES_BY_MATERIAL_TYPE = {
  aluminium: ['R4', 'R12', 'R13'],
  fibre: ['R3', 'R5', 'R12', 'R13'],
  glass: ['R5', 'R12', 'R13'],
  paper: ['R3', 'R12', 'R13'],
  plastic: ['R3', 'R12', 'R13'],
  steel: ['R4', 'R12', 'R13'],
  wood: ['R3', 'R12', 'R13']
}

/**
 * R12/R13 describe an operation performed in relation to an associated
 * interim site and can never be selected without at least one of R3/R4/R5
 * (an operation performed at the ORS itself) alongside them.
 */
export const CODES_REQUIRING_ACCOMPANIMENT = new Set(['R12', 'R13'])

/**
 * The codes applicable to a given (lowercase) material token. Falls back to
 * the full set when the token is missing/unrecognised, matching the operator
 * frontend's own fallback, rather than showing no options at all.
 */
export function applicableCodesForMaterialType(materialType) {
  if (typeof materialType !== 'string') {
    return ALL_CODES
  }
  return CODES_BY_MATERIAL_TYPE[materialType.toLowerCase()] ?? ALL_CODES
}

/**
 * AC10 / `requiresAccompanyingCode`: true only when R12/R13 is present with
 * nothing else. `codes` is otherwise assumed non-empty — the zero-codes case
 * (AC12) is a separate, earlier check.
 */
export function requiresAccompanyingCode(codes) {
  const hasAccompanimentCode = codes.some((c) =>
    CODES_REQUIRING_ACCOMPANIMENT.has(c)
  )
  const hasOtherCode = codes.some((c) => !CODES_REQUIRING_ACCOMPANIMENT.has(c))
  return hasAccompanimentCode && !hasOtherCode
}

/** AC11: true when the submitted codes include R12/R13 but the site has no interim site. */
export function requiresInterimSite(codes) {
  return codes.some((c) => CODES_REQUIRING_ACCOMPANIMENT.has(c))
}

/**
 * A checkbox group posts a bare string when one box is ticked and an array
 * when several are, and nothing at all when none are. Normalise defensively
 * so the schema only ever sees an array of strings.
 */
export function normaliseCodes(raw) {
  if (typeof raw === 'string') {
    return raw === '' ? [] : [raw]
  }
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === 'string' && v !== '')
  }
  return []
}

export const SELECT_CODES_MESSAGE = 'Select at least one recycling operation'
export const ACCOMPANYING_CODE_MESSAGE =
  'R12 and R13 cannot be selected on their own — select at least one other applicable recycling operation as well'
export const INTERIM_SITE_REQUIRED_MESSAGE =
  'R12 and R13 can only be selected for a site with an associated interim site'

export const recyclingOperationsFormSchema = Joi.object({
  codes: Joi.array()
    .items(Joi.string().valid(...ALL_CODES))
    .min(1)
    .required()
    .messages({
      'any.required': SELECT_CODES_MESSAGE,
      'array.base': SELECT_CODES_MESSAGE,
      'array.min': SELECT_CODES_MESSAGE,
      'array.includes': SELECT_CODES_MESSAGE,
      'any.only': SELECT_CODES_MESSAGE
    })
})

/**
 * Flatten Joi details into the `{ field: message }` shape the template
 * consumes. First error per field wins, matching `query.schema.js`.
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

const FIELD_ORDER = ['codes']

/**
 * Build a `govukErrorSummary` model. Anchors are `#field-<name>`, matching
 * the component ids used in `recycling-operations-edit.njk`.
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

// AC9-AC11, checked in order (first match wins) - split out of
// validateRecyclingOperationsForm to keep that function's own cyclomatic
// complexity under the lint threshold.
function codesFieldError(codes, { applicableCodes, hasInterimSite }) {
  // AC9: a code outside the application's material-type set is invalid,
  // same message as "select at least one" since the form never offered it.
  if (codes.length > 0 && !codes.every((c) => applicableCodes.includes(c))) {
    return SELECT_CODES_MESSAGE
  }

  // AC10: R12/R13 alone, with no R3/R4/R5 alongside.
  if (requiresAccompanyingCode(codes)) {
    return ACCOMPANYING_CODE_MESSAGE
  }

  // AC11: R12/R13 for a site with no associated interim site.
  if (!hasInterimSite && requiresInterimSite(codes)) {
    return INTERIM_SITE_REQUIRED_MESSAGE
  }

  return null
}

/**
 * Validate a raw Hapi payload for the Recycling operations edit form.
 *
 * @param {*} payload - the raw Hapi payload.
 * @param {object} [options]
 * @param {string[]} [options.applicableCodes] - the codes offered for this
 *   application's material type (AC9). Defaults to the full set when
 *   omitted. A submitted code outside this set is rejected (AC10-AC12 sit
 *   downstream of this — a code the form never offered cannot reach them).
 * @param {boolean} [options.hasInterimSite=false] - AC11: whether the site
 *   has an associated interim site. R12/R13 are rejected without one.
 * @returns {{ ok: true, value: { codes: string[] } }
 *          | { ok: false, fieldErrors: Record<string,string>,
 *              values: { codes: string[] } }}
 */
export function validateRecyclingOperationsForm(
  payload,
  { applicableCodes = ALL_CODES, hasInterimSite = false } = {}
) {
  const codes = normaliseCodes(payload?.codes)
  const values = { codes }

  const { error } = recyclingOperationsFormSchema.validate(
    { codes },
    { abortEarly: false, stripUnknown: true }
  )

  const fieldErrors = error ? joiDetailsToFieldErrors(error.details) : {}

  if (!fieldErrors.codes) {
    const codesError = codesFieldError(codes, {
      applicableCodes,
      hasInterimSite
    })
    if (codesError) {
      fieldErrors.codes = codesError
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors, values }
  }

  return { ok: true, value: { codes } }
}
