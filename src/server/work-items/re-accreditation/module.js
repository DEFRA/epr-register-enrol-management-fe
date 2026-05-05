import { registerModuleDetailTemplates } from '../core/templates.js'

/**
 * Re-accreditation work item module (RA-98).
 *
 * Reference module that proves the framework's "one folder + one
 * registration line" promise on the frontend. The `type` block mirrors the
 * backend `ReAccreditationType` declaratively so the registry can answer
 * questions about states / tasks / transitions without round-tripping to
 * the API. The `register` callback registers a type-specific detail
 * template; every state-changing UI action goes through the framework's
 * generic routes.
 *
 * The states / transitions / task ids encoded here intentionally match the
 * backend's `ReAccreditationType` so the two stay in lock-step. See
 * `docs/work-items.md` for the full lifecycle description and a reference
 * to the workflow diagram attached to RA-85.
 */

const STATES = [
  { id: 'submitted', displayName: 'Submitted' },
  { id: 'assessment-in-progress', displayName: 'Assessment in progress' },
  { id: 'awaiting-decision', displayName: 'Awaiting decision' },
  { id: 'approved', displayName: 'Approved', isTerminal: true },
  { id: 'rejected', displayName: 'Rejected', isTerminal: true },
  { id: 'withdrawn', displayName: 'Withdrawn', isTerminal: true }
]

const TRANSITIONS = [
  {
    actionId: 'start-assessment',
    displayName: 'Start assessment',
    fromStateId: 'submitted',
    toStateId: 'assessment-in-progress',
    requiresAllTasksComplete: true
  },
  {
    actionId: 'submit-for-decision',
    displayName: 'Submit for decision',
    fromStateId: 'assessment-in-progress',
    toStateId: 'awaiting-decision',
    requiresAllTasksComplete: true
  },
  {
    actionId: 'approve',
    displayName: 'Approve',
    fromStateId: 'awaiting-decision',
    toStateId: 'approved',
    requiresAllTasksComplete: true
  },
  {
    actionId: 'reject',
    displayName: 'Reject',
    fromStateId: 'awaiting-decision',
    toStateId: 'rejected',
    requiresAllTasksComplete: true
  },
  {
    actionId: 'withdraw',
    displayName: 'Withdraw',
    fromStateId: 'submitted',
    toStateId: 'withdrawn',
    requiresAllTasksComplete: false
  },
  {
    actionId: 'withdraw-during-assessment',
    displayName: 'Withdraw',
    fromStateId: 'assessment-in-progress',
    toStateId: 'withdrawn',
    requiresAllTasksComplete: false
  }
]

const TASKS_BY_STATE = {
  submitted: [
    {
      id: 'verify-organisation-details',
      displayName: 'Verify organisation details'
    },
    {
      id: 'confirm-registration-fee-paid',
      displayName: 'Confirm registration fee paid'
    }
  ],
  'assessment-in-progress': [
    {
      id: 'review-compliance-history',
      displayName: 'Review compliance history'
    },
    {
      id: 'assess-technical-capacity',
      displayName: 'Assess technical capacity'
    },
    {
      id: 'assess-financial-capacity',
      displayName: 'Assess financial capacity'
    }
  ],
  'awaiting-decision': [
    {
      id: 'record-decision-rationale',
      displayName: 'Record decision rationale'
    }
  ]
}

export const reAccreditationType = {
  id: 're-accreditation',
  displayName: 'Re-accreditation',
  templateVersion: 'v1',
  initialState: STATES[0],
  states: STATES,
  transitions: TRANSITIONS,
  getTasksForState(stateId) {
    return TASKS_BY_STATE[stateId] ?? []
  }
}

export const reAccreditationModule = {
  type: reAccreditationType,
  async register(_server) {
    // Mount the type-specific detail template so the framework's detail
    // controller picks it for `(re-accreditation, v1)` work items. All
    // other UI for this type goes through the framework's generic routes.
    registerModuleDetailTemplates('re-accreditation', {
      v1: 're-accreditation/detail-v1'
    })
  }
}
