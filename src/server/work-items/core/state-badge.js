/**
 * Single source of truth for work-item status badge colours (RA-324, AC08).
 *
 * The list (Applications tiles) and the individual work-item detail page must
 * colour a given status identically. Centralising the map here — rather than
 * duplicating a colour lookup in each controller — guarantees that
 * consistency and means a colour change is made in exactly one place.
 *
 * Keys are registered work-item state ids (shared with the backend, never
 * renamed — only their DisplayNames change). Values are GOV.UK Design System
 * `govuk-tag--*` modifier classes. An unknown id falls through to the neutral
 * grey tag so a newly-added backend state still renders a (muted) badge
 * rather than an unstyled one.
 */
// RA-324 phase-2. Colours realigned to Tom's prototype feedback. The AC06
// DisplayNames are UNCHANGED (Not started / Updated / Granted / Refused …) —
// only the badge colours move. `awaiting-decision` keeps a colour DISTINCT
// from the solid blue used by `assessment-in-progress`'s "Updated" so a
// caseworker can tell the decision-pending state apart at a glance (prototype
// allowed either "blue" or a distinct colour here — we keep it distinct with
// light-blue).
//
// RA-311 (rescoped, superseding the original plan doc — see PR description):
// the plan assumed CM had a single query-related state and proposed merging
// it into a turquoise "Updated". By the time this landed, RA-352 had already
// registered CM's real `updated` state (RA-311/MBE-1, RA-337 on the
// backend), so CM already has the same two-state split as OJ. `queried`
// (awaiting operator response) is deliberately left as-is; only `updated`
// (resubmitted, awaiting re-assessment) is recoloured to turquoise here, for
// parity with OJ FE's equivalent state (see
// epr-register-enrol-frontend/src/server/operator-accreditation/controller.js
// and .../accreditation/task-list/controller.js, both `Updated: { tagClass:
// 'govuk-tag--turquoise' }`).
const STATE_TAG_CLASSES = {
  submitted: 'govuk-tag--grey', // Not started
  'duly-made': 'govuk-tag--purple', // Duly made
  'assessment-in-progress': 'govuk-tag--blue', // Updated
  'awaiting-decision': 'govuk-tag--light-blue', // Awaiting decision (distinct)
  queried: 'govuk-tag--yellow', // Queried
  updated: 'govuk-tag--turquoise', // Updated (RA-311 turquoise parity with OJ)
  approved: 'govuk-tag--green', // Granted
  rejected: 'govuk-tag--red', // Refused
  withdrawn: 'govuk-tag--grey' // Withdrawn
}

const DEFAULT_STATE_TAG_CLASS = 'govuk-tag--grey'

/**
 * Resolve the `govuk-tag--*` class for a work-item state id. Falls back to
 * the neutral grey tag for unknown / absent ids.
 *
 * @param {string} [stateId]
 * @returns {string}
 */
export function stateTagClass(stateId) {
  return STATE_TAG_CLASSES[stateId] ?? DEFAULT_STATE_TAG_CLASS
}

// Exported purely for testability — production code resolves colours via
// `stateTagClass()` only. The unit test imports the raw map/default to assert
// the full contract in one place and to guard against the retired colours
// reappearing.
export { STATE_TAG_CLASSES, DEFAULT_STATE_TAG_CLASS }
