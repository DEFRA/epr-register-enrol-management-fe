import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import {
  canQueryWorkItem,
  evaluateQueryEligibility,
  isContinueReviewState,
  isPreDulyMadeWaypoint,
  QUERY_ELIGIBILITY
} from './re-accreditation-cta.js'

// Minimal re-accreditation type carrying only the transitions these
// predicates read: one `continue-review-during-*` (leaves from `updated`),
// `duly-make` and one `query-during-*` (both leave from `submitted`). The literals live here in the
// fixture exactly as they live in the real `module.js`, so the positive
// cases assert the helpers resolve them off the declaration.
function registerReaccreditation() {
  registerWorkItemType({
    id: 're-accreditation',
    displayName: 'Re-accreditation',
    initialState: { id: 'submitted', displayName: 'Submitted' },
    states: [
      { id: 'submitted', displayName: 'Submitted' },
      { id: 'duly-made', displayName: 'Duly made' },
      { id: 'updated', displayName: 'Updated' }
    ],
    transitions: [
      {
        actionId: 'duly-make',
        displayName: 'Duly make',
        fromStateId: 'submitted',
        toStateId: 'duly-made',
        callerInvocable: false
      },
      {
        actionId: 'query-during-duly-making',
        displayName: 'Query',
        fromStateId: 'submitted',
        toStateId: 'queried',
        callerInvocable: false
      },
      {
        actionId: 'continue-review-during-assessment',
        displayName: 'Continue review',
        fromStateId: 'updated',
        toStateId: 'assessment-in-progress',
        callerInvocable: false
      }
    ]
  })
}

describe('re-accreditation-cta helpers', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
  })

  describe('isContinueReviewState', () => {
    // The null guard (`if (stateId == null) return false`). Both inputs must
    // fail closed without ever touching the registry.
    it.each([null, undefined])('returns false for a %s stateId', (stateId) => {
      expect(isContinueReviewState(stateId)).toBe(false)
    })

    it('returns true for the state the continue-review-during-* transitions leave from', () => {
      registerReaccreditation()
      expect(isContinueReviewState('updated')).toBe(true)
    })

    it('returns false for a state no continue-review transition leaves from', () => {
      registerReaccreditation()
      expect(isContinueReviewState('submitted')).toBe(false)
    })

    // Fail CLOSED when the type is not registered: a wiring fault hides the
    // CTA rather than offering one the route would refuse.
    it('returns false when the re-accreditation type is not registered', () => {
      expect(isContinueReviewState('updated')).toBe(false)
    })
  })

  describe('isPreDulyMadeWaypoint', () => {
    // The symmetric null guard — cover it so it cannot silently regress.
    it.each([null, undefined])(
      'returns false for a %s originStateId',
      (originStateId) => {
        expect(isPreDulyMadeWaypoint(originStateId)).toBe(false)
      }
    )

    it('returns true when the origin is the state duly-make leaves from', () => {
      registerReaccreditation()
      expect(isPreDulyMadeWaypoint('submitted')).toBe(true)
    })

    it('returns false for an origin duly-make does not leave from', () => {
      registerReaccreditation()
      expect(isPreDulyMadeWaypoint('assessment-in-progress')).toBe(false)
    })

    // Fail CLOSED when the type (and therefore its duly-make transition) is
    // not registered.
    it('returns false when the re-accreditation type is not registered', () => {
      expect(isPreDulyMadeWaypoint('submitted')).toBe(false)
    })
  })

  describe('evaluateQueryEligibility', () => {
    const route = '/work-items/{id}'

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('is OK for a re-accreditation item in a state a query leaves from', () => {
      registerReaccreditation()
      expect(
        evaluateQueryEligibility(
          { id: 'wi-1', typeId: 're-accreditation', stateId: 'submitted' },
          { route }
        )
      ).toBe(QUERY_ELIGIBILITY.OK)
    })

    it('is NOT_QUERYABLE for a state no query leaves from', () => {
      registerReaccreditation()
      expect(
        evaluateQueryEligibility(
          { id: 'wi-1', typeId: 're-accreditation', stateId: 'updated' },
          { route }
        )
      ).toBe(QUERY_ELIGIBILITY.NOT_QUERYABLE)
    })

    it('is NOT_QUERYABLE for another work item type, without reading the registry', () => {
      expect(
        evaluateQueryEligibility(
          { id: 'wi-1', typeId: 'other-type', stateId: 'submitted' },
          { route }
        )
      ).toBe(QUERY_ELIGIBILITY.NOT_QUERYABLE)
    })

    it('is NO_STATE, logged at Error, for a re-accreditation item with no stateId', () => {
      const errorSpy = vi.spyOn(createLogger(), 'error')
      expect(
        evaluateQueryEligibility(
          { id: 'wi-1', typeId: 're-accreditation' },
          { route }
        )
      ).toBe(QUERY_ELIGIBILITY.NO_STATE)
      expect(errorSpy).toHaveBeenCalledWith(
        { workItemId: 'wi-1', route },
        expect.stringContaining('has no stateId')
      )
    })

    it('canQueryWorkItem is true only for OK', () => {
      registerReaccreditation()
      const item = (stateId) => ({
        id: 'wi-1',
        typeId: 're-accreditation',
        stateId
      })
      expect(canQueryWorkItem(item('submitted'), { route })).toBe(true)
      expect(canQueryWorkItem(item('updated'), { route })).toBe(false)
      vi.spyOn(createLogger(), 'error').mockImplementation(() => {})
      expect(canQueryWorkItem(item(undefined), { route })).toBe(false)
    })

    it('exposes frozen results', () => {
      expect(Object.isFrozen(QUERY_ELIGIBILITY)).toBe(true)
    })
  })
})
