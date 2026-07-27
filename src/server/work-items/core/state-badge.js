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
const STATE_TAG_CLASSES = {
  submitted: 'govuk-tag--grey',
  'duly-made': 'govuk-tag--blue',
  'assessment-in-progress': 'govuk-tag--light-blue',
  'awaiting-decision': 'govuk-tag--purple',
  queried: 'govuk-tag--yellow',
  updated: 'govuk-tag--light-blue',
  approved: 'govuk-tag--green',
  rejected: 'govuk-tag--red',
  withdrawn: 'govuk-tag--grey'
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

export { STATE_TAG_CLASSES, DEFAULT_STATE_TAG_CLASS }
