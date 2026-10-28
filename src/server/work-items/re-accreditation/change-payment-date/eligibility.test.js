import { describe, expect, test, beforeEach } from 'vitest'

import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '../../core/registry.js'
import { reAccreditationType } from '../module.js'
import {
  evaluateChangePaymentDateEligibility,
  readPaymentDate
} from './eligibility.js'

/**
 * RA-576. The single gate behind BOTH the side-panel link and the change
 * page's route guard. Runs against the REAL module declaration.
 */

function aWorkItem(overrides = {}) {
  const { payload, ...rest } = overrides
  return {
    id: 'wi-1',
    typeId: 're-accreditation',
    stateId: 'duly-made',
    payload: { paymentDate: '2026-07-15', ...payload },
    ...rest
  }
}

describe('evaluateChangePaymentDateEligibility', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
    registerWorkItemType(reAccreditationType)
  })

  test.each([
    'duly-made',
    'assessment-in-progress',
    'awaiting-decision',
    'queried',
    'updated',
    'approved-pending-contact',
    'rejected-pending-contact'
  ])('allows a %s item that has a payment date', (stateId) => {
    expect(
      evaluateChangePaymentDateEligibility(aWorkItem({ stateId }))
    ).toEqual({ allowed: true })
  })

  test.each(['approved', 'rejected', 'withdrawn'])(
    'refuses a terminal %s item',
    (stateId) => {
      expect(
        evaluateChangePaymentDateEligibility(aWorkItem({ stateId }))
      ).toEqual({ allowed: false, reason: 'terminal-state' })
    }
  )

  test('refuses an item with no payment date', () => {
    expect(
      evaluateChangePaymentDateEligibility(
        aWorkItem({ payload: { paymentDate: undefined } })
      )
    ).toEqual({ allowed: false, reason: 'no-payment-date' })
  })

  test('refuses another work item type', () => {
    expect(
      evaluateChangePaymentDateEligibility(aWorkItem({ typeId: 'other' }))
    ).toEqual({ allowed: false, reason: 'wrong-type' })
  })

  test('refuses an item with no state', () => {
    expect(
      evaluateChangePaymentDateEligibility(aWorkItem({ stateId: undefined }))
    ).toEqual({ allowed: false, reason: 'invalid-work-item' })
  })

  test('fails closed when the type is not registered', () => {
    clearWorkItemRegistry()
    expect(evaluateChangePaymentDateEligibility(aWorkItem())).toEqual({
      allowed: false,
      reason: 'type-not-registered'
    })
  })
})

describe('readPaymentDate', () => {
  test('returns the ISO and dd/mm/yyyy forms', () => {
    expect(readPaymentDate(aWorkItem())).toEqual({
      iso: '2026-07-15',
      display: '15/07/2026'
    })
  })

  test.each([undefined, null, '', 'garbage', '2026-07-15T00:00:00Z', 20260715])(
    'returns null for %s',
    (paymentDate) => {
      expect(
        readPaymentDate(aWorkItem({ payload: { paymentDate } }))
      ).toBeNull()
    }
  )
})
