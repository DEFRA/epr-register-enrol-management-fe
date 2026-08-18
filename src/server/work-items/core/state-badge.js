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
// only the badge colours move.
//
// RA-304 supersedes the phase-2 note about `awaiting-decision`, which used to
// carry a DISTINCT light-blue so a caseworker could pick the decision-pending
// state out at a glance. That state now displays as "Duly made" (see the
// RA-304 comment on STATES in `re-accreditation/module.js`), so a distinct
// colour would show two different-coloured badges reading the same word.
// It therefore shares `duly-made`'s purple. The map is still keyed by state
// id, not by label, so the collision is expressed as two keys with the same
// value rather than by dropping the entry.
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
  'awaiting-decision': 'govuk-tag--purple', // Duly made (RA-304 — same as duly-made)
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
