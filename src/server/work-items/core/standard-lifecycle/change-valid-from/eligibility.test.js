import { beforeEach, describe, expect, test } from 'vitest'

import { clearWorkItemRegistry, registerWorkItemType } from '../../registry.js'
import { addOverseasSiteType } from '../../../add-overseas-site/module.js'
import { reAccreditationType } from '../../../re-accreditation/module.js'
import {
  evaluateChangeValidFromEligibility,
  readValidFromDate
} from './eligibility.js'

const ADD_ORS = 'add-overseas-site'
const SCOPE = Object.freeze({ typeId: ADD_ORS })

function anItem(overrides = {}) {
  return {
    id: 'wi-1',
    typeId: ADD_ORS,
    stateId: 'approved-pending-contact',
    payload: { effectiveDate: '2026-03-27', accreditationYear: 2026 },
    ...overrides
  }
}

describe('readValidFromDate', () => {
  test('reads the stored date as ISO and dd/mm/yyyy', () => {
    expect(readValidFromDate(anItem())).toEqual({
      iso: '2026-03-27',
      display: '27/03/2026'
    })
  })

  test.each([
    [undefined],
    [null],
    [''],
    ['2026-03-27T00:00:00Z'],
    ['27/03/2026'],
    [20260327]
  ])('is null for %s', (effectiveDate) => {
    expect(readValidFromDate(anItem({ payload: { effectiveDate } }))).toBeNull()
  })

  test('is null without a payload', () => {
    expect(readValidFromDate({})).toBeNull()
    expect(readValidFromDate(null)).toBeNull()
  })
})

describe('evaluateChangeValidFromEligibility', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
    registerWorkItemType(addOverseasSiteType)
    registerWorkItemType(reAccreditationType)
  })

  test('allows an approved case awaiting applicant contact with a date', () => {
    expect(evaluateChangeValidFromEligibility(anItem(), SCOPE)).toEqual({
      allowed: true
    })
  })

  test.each([
    'submitted',
    'duly-made',
    'assessment-started',
    'rejected-pending-contact',
    'approved',
    'rejected'
  ])('refuses a %s case', (stateId) => {
    expect(
      evaluateChangeValidFromEligibility(anItem({ stateId }), SCOPE)
    ).toEqual({ allowed: false, reason: 'invalid-state' })
  })

  test('refuses a case with no valid-from date', () => {
    expect(
      evaluateChangeValidFromEligibility(anItem({ payload: {} }), SCOPE)
    ).toEqual({ allowed: false, reason: 'no-valid-from-date' })
  })

  test('refuses a work item of another type', () => {
    expect(
      evaluateChangeValidFromEligibility(
        anItem({ typeId: 're-accreditation' }),
        SCOPE
      )
    ).toEqual({ allowed: false, reason: 'wrong-type' })
  })

  test('refuses a type that does not take a valid-from date (opt-in)', () => {
    expect(
      evaluateChangeValidFromEligibility(
        anItem({ typeId: 're-accreditation' }),
        { typeId: 're-accreditation' }
      )
    ).toEqual({ allowed: false, reason: 'not-supported' })
  })

  test('refuses when the type is not registered', () => {
    clearWorkItemRegistry()
    expect(evaluateChangeValidFromEligibility(anItem(), SCOPE)).toEqual({
      allowed: false,
      reason: 'type-not-registered'
    })
  })

  test('refuses a work item with no state', () => {
    expect(
      evaluateChangeValidFromEligibility(anItem({ stateId: undefined }), SCOPE)
    ).toEqual({ allowed: false, reason: 'invalid-work-item' })
  })
})
