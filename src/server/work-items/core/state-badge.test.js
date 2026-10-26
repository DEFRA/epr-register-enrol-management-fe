import { describe, test, expect } from 'vitest'

import {
  stateTagClass,
  STATE_TAG_CLASSES,
  DEFAULT_STATE_TAG_CLASS
} from './state-badge.js'

describe('#stateTagClass', () => {
  // RA-324 (AC08). The contract colour for every registered state id. This is
  // the single source of truth shared by the Applications list and the detail
  // page, so a drift here is a visible cross-page inconsistency.
  // RA-324 phase-2 prototype colours (AC06 labels unchanged).
  test.each([
    ['submitted', 'govuk-tag--grey'],
    ['duly-made', 'govuk-tag--purple'],
    ['assessment-in-progress', 'govuk-tag--blue'],
    ['awaiting-decision', 'govuk-tag--light-blue'],
    ['queried', 'govuk-tag--yellow'],
    ['updated', 'govuk-tag--turquoise'],
    // RA-527: approved, applicant not yet contacted. Same colour as Granted.
    ['approved-pending-contact', 'govuk-tag--green'],
    // RA-527: refused, applicant not yet contacted. Same colour as Refused.
    ['rejected-pending-contact', 'govuk-tag--red'],
    ['approved', 'govuk-tag--green'],
    ['rejected', 'govuk-tag--red'],
    ['withdrawn', 'govuk-tag--grey']
  ])('maps %s to %s', (stateId, expected) => {
    expect(stateTagClass(stateId)).toBe(expected)
  })

  test('falls back to the neutral grey tag for an unknown id', () => {
    expect(stateTagClass('mystery')).toBe(DEFAULT_STATE_TAG_CLASS)
    expect(DEFAULT_STATE_TAG_CLASS).toBe('govuk-tag--grey')
  })

  test('falls back to the neutral grey tag for an absent id', () => {
    expect(stateTagClass(undefined)).toBe('govuk-tag--grey')
    expect(stateTagClass(null)).toBe('govuk-tag--grey')
  })

  test('exposes the raw map for callers that need the full set', () => {
    expect(STATE_TAG_CLASSES.queried).toBe('govuk-tag--yellow')
    // The retired RA-291 orange must not reappear, on queried or anywhere.
    expect(Object.values(STATE_TAG_CLASSES)).not.toContain('govuk-tag--orange')
  })

  // RA-527. Each step 1 (pending-contact) state shares its final state's
  // colour: Approved matches Granted, and the step 1 Refused matches the
  // final Refused.
  test.each([
    ['approved-pending-contact', 'approved'],
    ['rejected-pending-contact', 'rejected']
  ])('%s has the same colour as %s', (pendingStateId, finalStateId) => {
    expect(stateTagClass(pendingStateId)).toBe(stateTagClass(finalStateId))
  })

  test('only "Awaiting decision" is light blue', () => {
    expect(
      Object.entries(STATE_TAG_CLASSES)
        .filter(([, tagClass]) => tagClass === 'govuk-tag--light-blue')
        .map(([stateId]) => stateId)
    ).toEqual(['awaiting-decision'])
  })
})
