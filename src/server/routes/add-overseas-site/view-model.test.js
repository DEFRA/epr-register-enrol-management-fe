import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { applyAddOverseasSiteViewModel } from './view-model.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { reAccreditationType } from '#/server/work-items/re-accreditation/module.js'

const ROUTE = '/work-items/{id}'
const item = (overrides = {}) => ({
  id: 'wi-1',
  typeId: 'add-overseas-site',
  stateId: 'submitted',
  ...overrides
})

describe('applyAddOverseasSiteViewModel (RA-698)', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
    registerWorkItemType(reAccreditationType)
  })

  afterEach(() => {
    clearWorkItemRegistry()
  })

  test.each(['submitted', 'duly-made', 'assessment-in-progress'])(
    'offers Raise a query in %s',
    (stateId) => {
      const result = applyAddOverseasSiteViewModel({
        workItem: item({ stateId }),
        route: ROUTE
      })
      expect(result.canQuery).toBe(true)
      expect(result.queryHref).toBe('/work-items/wi-1/query')
      expect(result.canContinueReview).toBe(false)
    }
  )

  test.each(['queried', 'approved', 'rejected', 'withdrawn'])(
    'does not offer Raise a query in %s',
    (stateId) => {
      expect(
        applyAddOverseasSiteViewModel({
          workItem: item({ stateId }),
          route: ROUTE
        }).canQuery
      ).toBe(false)
    }
  )

  test('offers Continue review once updated, posting to the add-ORS route', () => {
    const result = applyAddOverseasSiteViewModel({
      workItem: item({ stateId: 'updated' }),
      source: item({
        stateId: 'updated',
        originStateId: 'assessment-in-progress'
      }),
      route: ROUTE
    })
    expect(result.canContinueReview).toBe(true)
    expect(result.continueReviewHref).toBe(
      '/work-items/add-overseas-site/wi-1/continue-review'
    )
    expect(result.canQuery).toBe(false)
  })

  test('does not offer Continue review for an item queried before it was duly made', () => {
    const result = applyAddOverseasSiteViewModel({
      workItem: item({ stateId: 'updated' }),
      source: item({ stateId: 'updated', originStateId: 'submitted' }),
      route: ROUTE
    })
    expect(result.canContinueReview).toBe(false)
  })

  test('leaves another type unchanged', () => {
    const other = item({ typeId: 're-accreditation' })
    expect(
      applyAddOverseasSiteViewModel({ workItem: other, route: ROUTE })
    ).toBe(other)
  })
})
