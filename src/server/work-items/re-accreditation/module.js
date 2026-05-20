import { config } from '#/config/config.js'
import { registerModuleDetailTemplates } from '../core/templates.js'
import { buildApprovalRoutes } from './approval/routes.js'
import { buildCreateWorkItemRoutes } from './create/routes.js'

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
  { id: 'duly-made', displayName: 'Duly made' },
  { id: 'assessment-in-progress', displayName: 'Assessment in progress' },
  { id: 'awaiting-decision', displayName: 'Awaiting decision' },
  { id: 'approved', displayName: 'Approved', isTerminal: true },
  { id: 'rejected', displayName: 'Rejected', isTerminal: true },
  { id: 'withdrawn', displayName: 'Withdrawn', isTerminal: true }
]

const TRANSITIONS = [
  {
    actionId: 'duly-make',
    displayName: 'Mark as duly made',
    fromStateId: 'submitted',
    toStateId: 'duly-made',
    requiresAllTasksComplete: true
  },
  {
    actionId: 'payment-received',
    displayName: 'Payment received',
    fromStateId: 'duly-made',
    toStateId: 'assessment-in-progress',
    requiresAllTasksComplete: true
  },
  {
    actionId: 'sla-extend',
    displayName: 'Extend SLA',
    fromStateId: 'assessment-in-progress',
    toStateId: 'assessment-in-progress',
    requiresAllTasksComplete: false
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
    actionId: 'withdraw-during-duly-made',
    displayName: 'Withdraw',
    fromStateId: 'duly-made',
    toStateId: 'withdrawn',
    requiresAllTasksComplete: false
  },
  {
    actionId: 'withdraw-during-assessment',
    displayName: 'Withdraw',
    fromStateId: 'assessment-in-progress',
    toStateId: 'withdrawn',
    requiresAllTasksComplete: false
  },
  {
    actionId: 'withdraw-during-decision',
    displayName: 'Withdraw',
    fromStateId: 'awaiting-decision',
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
      id: 'confirm-application-completeness',
      displayName: 'Confirm application is duly made'
    }
  ],
  'duly-made': [
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
  templateVersion: 'v4',
  initialState: STATES[0],
  states: STATES,
  transitions: TRANSITIONS,
  getTasksForState(stateId) {
    return TASKS_BY_STATE[stateId] ?? []
  }
}

export const reAccreditationModule = {
  type: reAccreditationType,
  async register(server) {
    // Mount the type-specific detail template so the framework's detail
    // controller picks it for `(re-accreditation, v1)` work items. All
    // other UI for this type goes through the framework's generic routes.
    // v2: added duly-made state; v3: notify hook; v4: SLA clock
    registerModuleDetailTemplates('re-accreditation', {
      v1: 're-accreditation/detail-v1',
      v2: 're-accreditation/detail-v1',
      v3: 're-accreditation/detail-v1',
      v4: 're-accreditation/detail-v1'
    })

    // RA-132. Approve-determination flow: confirmation interstitial + POST
    // handler that hits the type-specific backend endpoint. Always mounted
    // — the FE button only renders when the work item is eligible, and
    // the backend is the source of truth for authorisation.
    server.route(buildApprovalRoutes())

    // RA-127. The create-work-item demo form is feature-flagged so it
    // can be hidden in production. When the flag is off the routes are
    // not mounted at all — the page is a 404 rather than an explicit
    // "feature disabled" page.
    if (config.get('featureFlags.workItemCreationEnabled')) {
      server.route(buildCreateWorkItemRoutes())
    }
  }
}
