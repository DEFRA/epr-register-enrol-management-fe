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
 *
 * Order is the prototype's alphabetical-by-label order.
 */
export const MATERIAL_FILTER_OPTIONS = [
  { value: 'aluminium', text: 'Aluminium' },
  { value: 'fibre', text: 'Fibre-based composite material' },
  { value: 'glass', text: 'Glass' },
  { value: 'paper', text: 'Paper or board' },
  { value: 'plastic', text: 'Plastic' },
  { value: 'steel', text: 'Steel' },
  { value: 'wood', text: 'Wood' }
]

const LABEL_BY_TOKEN = new Map(
  MATERIAL_FILTER_OPTIONS.map((o) => [o.value, o.text])
)

/** The set of valid material tokens, for validating query input. */
export const MATERIAL_TOKENS = MATERIAL_FILTER_OPTIONS.map((o) => o.value)

/**
 * Resolve a material token to its display label. Matches case-insensitively
 * (payload values are lowercase but be defensive). Returns the original value
 * unchanged when it is not a recognised token, so an unexpected material still
 * renders *something* rather than blank.
 *
 * @param {string} [token]
 * @returns {string|null}
 */
export function materialLabel(token) {
  if (token == null || token === '') return null
  return LABEL_BY_TOKEN.get(String(token).toLowerCase()) ?? token
}
