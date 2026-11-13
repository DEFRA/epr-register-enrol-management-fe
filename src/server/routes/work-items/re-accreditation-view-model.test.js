import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { reAccreditationType } from '#/server/work-items/re-accreditation/module.js'
import {
  STATE_APPROVED_PENDING_CONTACT,
  STATE_REJECTED_PENDING_CONTACT
} from '#/server/work-items/re-accreditation/states.js'

import { applyReAccreditationViewModel } from './re-accreditation-view-model.js'

const ROUTE = '/work-items/{id}'

function reAccreditation(overrides = {}) {
  return {
    id: 'wi/1',
    typeId: 're-accreditation',
    stateId: 'awaiting-decision',
    canChangeDueDate: true,
    payload: {},
    ...overrides
  }
}

describe('#applyReAccreditationViewModel', () => {
  beforeAll(() => registerWorkItemType(reAccreditationType))
  afterAll(() => clearWorkItemRegistry())

  test('returns any other type untouched', () => {
    const workItem = { id: 'wi-1', typeId: 'add-overseas-site' }

    expect(applyReAccreditationViewModel({ workItem, route: ROUTE })).toBe(
      workItem
    )
  })

  test('offers the decision CTA and encodes the id into every href', () => {
    const result = applyReAccreditationViewModel({
      workItem: reAccreditation(),
      route: ROUTE
    })

    expect(result).toMatchObject({
      canLogDecision: true,
      logDecisionHref: '/work-items/re-accreditation/wi%2F1/decision',
      dulyMakeHref: '/work-items/re-accreditation/wi%2F1/duly-make',
      changePaymentDateHref:
        '/work-items/re-accreditation/wi%2F1/change-payment-date',
      continueReviewHref: '/work-items/re-accreditation/wi%2F1/continue-review',
      confirmContactHref: '/work-items/re-accreditation/wi%2F1/confirm-contact',
      canChangeDueDate: true,
      isPendingContact: false,
      pendingContactBanner: null,
      isReadOnlyState: false,
      decisionMetadata: null
    })
  })

  test('gates eligibility on the raw source, not the decorated view model', () => {
    const result = applyReAccreditationViewModel({
      workItem: reAccreditation({ stateId: 'approved' }),
      source: reAccreditation(),
      route: ROUTE
    })

    expect(result.canLogDecision).toBe(true)
    expect(result.isReadOnlyState).toBe(true)
  })

  test('an approval awaiting contact shows the banner with its accreditation ID and no deadline control', () => {
    const result = applyReAccreditationViewModel({
      workItem: reAccreditation({
        stateId: STATE_APPROVED_PENDING_CONTACT,
        payload: { accreditationId: 'ACC-1' }
      }),
      route: ROUTE
    })

    expect(result.isPendingContact).toBe(true)
    expect(result.canChangeDueDate).toBe(false)
    expect(result.pendingContactBanner).toEqual({
      title: 'Application approved',
      text: 'The application was approved. You now need to contact the applicant about the decision.',
      accreditationId: 'ACC-1'
    })
  })

  test('a refusal awaiting contact shows the banner with no accreditation ID', () => {
    const result = applyReAccreditationViewModel({
      workItem: reAccreditation({ stateId: STATE_REJECTED_PENDING_CONTACT }),
      route: ROUTE
    })

    expect(result.pendingContactBanner).toEqual({
      title: 'Application refused',
      text: 'The application was refused. You now need to contact the applicant about the decision.',
      accreditationId: null
    })
  })

  test.each([
    ['assessment-in-progress', true],
    ['submitted', false]
  ])(
    'an updated item queried from %s offers Continue review: %s',
    (originStateId, expected) => {
      const result = applyReAccreditationViewModel({
        workItem: reAccreditation({ stateId: 'updated', originStateId }),
        route: ROUTE
      })

      expect(result.canContinueReview).toBe(expected)
    }
  )
})
