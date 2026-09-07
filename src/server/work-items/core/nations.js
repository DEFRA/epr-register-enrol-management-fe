/**
 * UK nation ↔ display label (RA-526).
 *
 * `England`/`Scotland`/`Wales`/`NorthernIreland` are management-be's `Nation`
 * enum member names verbatim — the wire contract for `payload.nation`
 * (`ReAccreditationNationRoutingHook`), the Nation FILTER on the work-items
 * list, and the Nation field on the manual create-work-item form. All three
 * previously kept their own copy of this same value↔label pairing; this is
 * the single source of truth they now share, so the values and labels can't
 * drift out of agreement with each other or with the enum they represent.
 *
 * Order is alphabetical by value, matching the work-items list filter's
 * original convention.
 */
export const NATION_OPTIONS = [
  { value: 'England', text: 'England' },
  { value: 'NorthernIreland', text: 'Northern Ireland' },
  { value: 'Scotland', text: 'Scotland' },
  { value: 'Wales', text: 'Wales' }
]

/** The set of valid nation values, for Joi/query validation. */
export const NATION_VALUES = NATION_OPTIONS.map((o) => o.value)

const LABEL_BY_VALUE = new Map(NATION_OPTIONS.map((o) => [o.value, o.text]))

/**
 * Resolve a nation value to its display label. Falls back to the raw value
 * for anything unrecognised, so a future/unexpected nation still renders as
 * plain text rather than disappearing.
 *
 * @param {string} [value]
 * @returns {string}
 */
export function nationLabel(value) {
  return LABEL_BY_VALUE.get(value) ?? value
}
