/**
 * Packaging material tokens ↔ display labels (RA-324 phase-2).
 *
 * The work-item `payload.material` stores a LOWERCASE token (e.g. "plastic"),
 * originating from the operator submission (see the operator backend's
 * `MaterialType` enum / `data-generators.js MATERIALS`). The case-management
 * UI needs two things from the same source of truth:
 *   - the Material filter checkboxes (value = token, text = display label), and
 *   - a display label for the token on each application card.
 *
 * The backend matches whatever tokens we send case-insensitively, so the
 * tokens here are the wire contract; the labels are ours to present (the
 * RA-324 prototype uses the fuller "Fibre-based composite material" / "Paper
 * or board" wording rather than the bare operator labels).
 */

/**
 * Display label for the RAW backend material token stored on a work item
 * payload (`item.payload.material`).
 */
const DISPLAY_LABEL_BY_BACKEND_TOKEN = new Map([
  ['aluminium', 'Aluminium'],
  ['fibre', 'Fibre-based composite material'],
  ['glass', 'Glass'],
  ['paper', 'Paper or board'],
  ['plastic', 'Plastic'],
  ['steel', 'Steel'],
  ['wood', 'Wood']
])

/**
 * RA-307: glass recycling process wire value (`payload.glassRecyclingProcess`,
 * stamped onto the payload by the operator backend's HttpCaseWorkingApiAdapter
 * as a plain string) ↔ the suffix appended to the Glass display label.
 */
const GLASS_RECYCLING_PROCESS_SUFFIX = new Map([
  ['glass_re_melt', 'Remelt'],
  ['glass_other', 'Other']
])

/**
 * Resolve a RAW backend material token (e.g. `item.payload.material`) to its
 * display label. Matches case-insensitively (payload values are lowercase but
 * be defensive). Returns the original value unchanged when it is not a
 * recognised token, so an unexpected material still renders *something*
 * rather than blank.
 *
 * RA-307: when the material is glass and `glassRecyclingProcess` is a
 * recognised wire value, appends "- Remelt"/"- Other" to match the operator
 * frontend's "Glass - Remelt"/"Glass - Other" wording. Omitted (falls back to
 * plain "Glass") when the recycling process is absent or unrecognised.
 *
 * @param {string} [token]
 * @param {string} [glassRecyclingProcess]
 * @returns {string|null}
 */
export function materialLabel(token, glassRecyclingProcess) {
  if (token == null || token === '') return null
  const label =
    DISPLAY_LABEL_BY_BACKEND_TOKEN.get(String(token).toLowerCase()) ?? token

  if (String(token).toLowerCase() !== 'glass') return label

  const suffix = GLASS_RECYCLING_PROCESS_SUFFIX.get(glassRecyclingProcess)
  return suffix ? `${label} - ${suffix}` : label
}

/**
 * Material FILTER checkboxes (UI-facing values, submitted via `material=`).
 *
 * RA-299 AC05 splits the single "Glass" checkbox into "Glass- remelt" and
 * "Glass- other". At the time this was written, `item.payload.material` had
 * no remelt/other distinction, so this was a FILTER-UI-ONLY split ahead of
 * the data model, not a reflection of real data variance. RA-307 has since
 * added `item.payload.glassRecyclingProcess` (see `materialLabel` above),
 * closing that data-model gap for DISPLAY purposes — but the two checkboxes
 * below still both query the single `glass` backend token, so this section's
 * original judgement call stands for FILTERING specifically until it's
 * revisited to filter on the new field too:
 *
 * unlike the Reprocessor/Exporter type-filter precedent (RA-324 phase-2,
 * where the not-yet-existing `exporter` typeId is EXPECTED to return zero
 * results because no exporter data exists at all), giving "Glass- remelt" and
 * "Glass- other" two brand-new backend tokens would regress existing
 * behaviour: every work item that currently matches the single "Glass"
 * filter would silently disappear from BOTH new checkboxes, since neither
 * would match the real `glass` token. That's a functional regression, not a
 * faithful zero-result stub. So both new UI values map back to the SAME real
 * `glass` backend token below — either checkbox surfaces all current Glass
 * work items (identical result sets) until filtering is updated to use the
 * new `glassRecyclingProcess` field, at which point only the
 * `FILTER_TO_BACKEND_MATERIAL_TOKENS` mapping needs to change.
 *
 * Order is the prototype's alphabetical-by-label order.
 */
export const MATERIAL_FILTER_OPTIONS = [
  { value: 'aluminium', text: 'Aluminium' },
  { value: 'fibre', text: 'Fibre-based composite material' },
  { value: 'glass-other', text: 'Glass- other' },
  { value: 'glass-remelt', text: 'Glass- remelt' },
  { value: 'paper', text: 'Paper or board' },
  { value: 'plastic', text: 'Plastic' },
  { value: 'steel', text: 'Steel' },
  { value: 'wood', text: 'Wood' }
]

const FILTER_LABEL_BY_VALUE = new Map(
  MATERIAL_FILTER_OPTIONS.map((o) => [o.value, o.text])
)

/**
 * Resolve a material FILTER value (a checkbox `value`, e.g. `glass-remelt`)
 * to its display label, for active-filter chips. Distinct from
 * `materialLabel`, which labels the raw backend payload token instead.
 *
 * @param {string} value
 * @returns {string}
 */
export function materialFilterLabel(value) {
  return FILTER_LABEL_BY_VALUE.get(value) ?? value
}

/** The set of valid material FILTER tokens, for validating query input. */
export const MATERIAL_TOKENS = MATERIAL_FILTER_OPTIONS.map((o) => o.value)

/**
 * Maps a material FILTER value to the real backend material token(s) it
 * should match. Most map 1:1 (identity); both glass sub-options map to the
 * single real `glass` token (see the AC05 reasoning above).
 */
const FILTER_TO_BACKEND_MATERIAL_TOKENS = new Map([
  ['glass-remelt', ['glass']],
  ['glass-other', ['glass']]
])

/**
 * Translate the UI-facing material FILTER values (already validated against
 * `MATERIAL_TOKENS`) into the real backend material token(s) to send to the
 * backend query. Deduplicates the result.
 *
 * @param {string[]} filterValues
 * @returns {string[]}
 */
export function toBackendMaterialTokens(filterValues) {
  const out = new Set()
  for (const value of filterValues) {
    const mapped = FILTER_TO_BACKEND_MATERIAL_TOKENS.get(value)
    if (mapped) {
      mapped.forEach((token) => out.add(token))
    } else {
      out.add(value)
    }
  }
  return [...out]
}
