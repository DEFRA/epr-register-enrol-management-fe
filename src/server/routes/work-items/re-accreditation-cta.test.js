import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import {
  isContinueReviewState,
  isPreDulyMadeWaypoint
} from './re-accreditation-cta.js'

// Minimal re-accreditation type carrying only the transitions these two
// predicates read: one `continue-review-during-*` (leaves from `updated`)
// and `duly-make` (leaves from `submitted`). The literals live here in the
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
})
