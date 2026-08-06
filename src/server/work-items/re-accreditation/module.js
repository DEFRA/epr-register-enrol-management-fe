import { config } from '#/config/config.js'
import { registerModuleDetailTemplates } from '../core/templates.js'
import { buildApprovalRoutes } from './approval/routes.js'
import { buildContinueReviewRoutes } from './continue-review/routes.js'
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

// RA-324. State DisplayNames are aligned with the Applications-page label
// contract and mirror the backend's rename byte-for-byte. The state *ids* are
// unchanged (they are the shared wire contract); only the human labels move,
// so no templateVersion bump is required for the rename itself. Note the
// intentional collision: both `assessment-in-progress` and `updated` display
// as "Updated" (literal AC06, confirmed with the backend — do not reconcile).
const STATES = [
  { id: 'submitted', displayName: 'Not started' },
  { id: 'duly-made', displayName: 'Duly made' },
  { id: 'assessment-in-progress', displayName: 'Updated' },
  { id: 'awaiting-decision', displayName: 'Awaiting decision' },
  // RA-211 / RA-291. Deliberately NOT terminal: a queried application is
  // paused awaiting the operator's resubmission, after which it re-enters
  // assessment. Added here so the state label resolves — the detail view,
  // the cross-type list and the audit log all read display names from
  // this array, and an unknown id falls back to the raw lowercase id.
  { id: 'queried', displayName: 'Queried' },
  // RA-337. Deliberately NOT terminal: a resubmitted-but-not-yet-reviewed
  // application lands here (instead of jumping straight back to the state
  // it was queried from) so the state label resolves rather than falling
  // back to the raw id — see the RA-291 comment above for the class of bug
  // this guards against.
  { id: 'updated', displayName: 'Updated' },
  { id: 'approved', displayName: 'Granted', isTerminal: true },
  { id: 'rejected', displayName: 'Refused', isTerminal: true },
  { id: 'withdrawn', displayName: 'Withdrawn', isTerminal: true }
]

const TRANSITIONS = [
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
  // RA-132 / RA-372. `approve` is deliberately NOT declared. The backend
  // omits it from `ReAccreditationType.Transitions` on purpose, so its
  // generic engine rejects `/work-items/{id}/actions/approve` and a caller
  // cannot bypass the bespoke side-effects of
  // `ReAccreditationApprovalService` (accreditation id issuance, SLA clock
  // stop, queued publishing job). Declaring it here would make the mirror
  // claim a generic action that does not exist and that the backend would
  // refuse. The Approve CTA is driven by `canApproveDirectly` (a state
  // check in the detail controller) and posts to the type-specific
  // `/work-items/re-accreditation/{id}/approve`, never through the
  // generic action route. `reject` DOES go through the generic engine and
  // so is declared below.
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
  },
  {
    actionId: 'withdraw-during-query',
    displayName: 'Withdraw',
    fromStateId: 'queried',
    toStateId: 'withdrawn',
    requiresAllTasksComplete: false
  },
  {
    actionId: 'withdraw-during-updated',
    displayName: 'Withdraw',
    fromStateId: 'updated',
    toStateId: 'withdrawn',
    requiresAllTasksComplete: false
  },
  // RA-291 / RA-211. A case worker can query an application from any
  // pre-decision state. Caller-invocable: each has a distinct
  // `fromStateId`, so the engine's from-state guard resolves them
  // unambiguously and the caller picking one is safe. There is
  // deliberately no transition out of `queried` back to `queried` — an
  // application awaiting a response cannot be queried again.
  {
    actionId: 'query-during-duly-making',
    displayName: 'Query',
    fromStateId: 'submitted',
    toStateId: 'queried',
    requiresAllTasksComplete: false
  },
  {
    actionId: 'query-during-duly-made',
    displayName: 'Query',
    fromStateId: 'duly-made',
    toStateId: 'queried',
    requiresAllTasksComplete: false
  },
  {
    actionId: 'query-during-assessment',
    displayName: 'Query',
    fromStateId: 'assessment-in-progress',
    toStateId: 'queried',
    requiresAllTasksComplete: false
  },
  {
    actionId: 'query-during-decision',
    displayName: 'Query',
    fromStateId: 'awaiting-decision',
    toStateId: 'queried',
    requiresAllTasksComplete: false
  },
  // RA-311/MBE-1. The inverse of the four `query-during-*` above: an
  // operator's resubmission moves the application out of `queried` and
  // into `updated`. Same `callerInvocable: false` reasoning as the
  // `continue-review-during-*` block below — all four share
  // `fromStateId: 'queried'`, so a caller who could invoke them directly
  // would pick the target state regardless of where the item was actually
  // queried from, bypassing the backend's audit-history resolution and
  // skipping intermediate states and their tasks entirely.
  {
    actionId: 'resume-during-duly-making',
    displayName: 'Resume',
    fromStateId: 'queried',
    toStateId: 'updated',
    requiresAllTasksComplete: false,
    callerInvocable: false
  },
  {
    actionId: 'resume-during-duly-made',
    displayName: 'Resume',
    fromStateId: 'queried',
    toStateId: 'updated',
    requiresAllTasksComplete: false,
    callerInvocable: false
  },
  {
    actionId: 'resume-during-assessment',
    displayName: 'Resume',
    fromStateId: 'queried',
    toStateId: 'updated',
    requiresAllTasksComplete: false,
    callerInvocable: false
  },
  {
    actionId: 'resume-during-decision',
    displayName: 'Resume',
    fromStateId: 'queried',
    toStateId: 'updated',
    requiresAllTasksComplete: false,
    callerInvocable: false
  },
  // RA-372. The four onward transitions out of `updated`, one per state a
  // query can be raised from. Mirrored here because the frontend now
  // *drives* this transition (the "Continue review" CTA), so the mirror
  // going on claiming `updated` is a dead end would be actively
  // misleading. The same argument applied to `queried`, which is why the
  // `query-during-*` / `resume-during-*` blocks above landed at the same
  // time: this list is now a complete mirror of the backend's
  // `ReAccreditationType.Transitions`, and should be kept that way.
  //
  // `callerInvocable: false` matters and is not decoration: the backend
  // declares all four that way, and resolves which one applies from the
  // work item's own `resume-during-*` audit history. A caller must never
  // pick — all four share `fromStateId: 'updated'`, so a caller-chosen
  // action could send the application to the wrong (attacker-selected)
  // stage. That is exactly why the UI posts to the type-specific
  // `/continue-review` endpoint instead of the generic
  // `/actions/{actionId}` route, and why `projectWorkItem` filters these
  // out of `availableActions` rather than rendering four buttons.
  {
    actionId: 'continue-review-during-duly-making',
    displayName: 'Continue review',
    fromStateId: 'updated',
    toStateId: 'submitted',
    requiresAllTasksComplete: false,
    callerInvocable: false
  },
  {
    actionId: 'continue-review-during-duly-made',
    displayName: 'Continue review',
    fromStateId: 'updated',
    toStateId: 'duly-made',
    requiresAllTasksComplete: false,
    callerInvocable: false
  },
  {
    actionId: 'continue-review-during-assessment',
    displayName: 'Continue review',
    fromStateId: 'updated',
    toStateId: 'assessment-in-progress',
    requiresAllTasksComplete: false,
    callerInvocable: false
  },
  {
    actionId: 'continue-review-during-decision',
    displayName: 'Continue review',
    fromStateId: 'updated',
    toStateId: 'awaiting-decision',
    requiresAllTasksComplete: false,
    callerInvocable: false
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
  // RA-372. There is deliberately NO `updated` entry, and adding one would
  // be wrong. `updated` owns no tasks of its own; while an item sits there
  // the backend projects the tasks of the state the query was raised from,
  // resolved per work item from its audit history and carrying that
  // state's existing completion status. That is a property of the
  // individual work item, not of the state, so it cannot be expressed in
  // this static map — the detail and tasks pages read `workItem.tasks`
  // off the API response and render whatever the backend projected.
}

export const reAccreditationType = {
  id: 're-accreditation',
  displayName: 'Re-accreditation',
  // Mirrors `ReAccreditationType.TemplateVersion` in the backend, which is
  // the value actually stamped onto work items. Keep the two in lock-step
  // and add the matching entry to the detail-template map below.
  templateVersion: 'v10',
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
    // controller picks it for `(re-accreditation, v*)` work items. All
    // other UI for this type goes through the framework's generic routes.
    // v2: added duly-made state; v3: notify hook; v4: SLA clock
    // v5: removed duly-make action (auto-transition on task completion)
    // v6: RA-291 query-during-* transitions + queried state
    // v7: RA-311/MBE-1 resume-during-* transitions out of queried
    // v8: RA-337 resume-during-* now lands on the new 'updated' state,
    //     plus continue-review-during-* transitions out of it
    // v9: RA-252 withdraw-during-query transition out of 'queried'
    // v10: RA-252 withdraw-during-updated transition out of 'updated'
    //
    // RA-372 deliberately did NOT bump the version (confirmed with the
    // backend). Showing the originating state's tasks while an item is in
    // `updated` is a projection-time fix applied against the snapshot each
    // work item already carries, so live v8/v9/v10 items are corrected
    // without a migration and without a new entry below.
    //
    // ⚠ THIS MAP MUST GAIN AN ENTRY WHENEVER THE BACKEND BUMPS
    // `ReAccreditationType.TemplateVersion`. The backend stamps its
    // version onto every work item at submission and the framework
    // resolves the detail template by that stamped value — an
    // unregistered version silently falls back to the GENERIC detail
    // template, losing this type's approve CTA and actions panel with
    // no error anywhere. `module.test.js` guards the current version,
    // and the framework itself asserts this at boot (see
    // `assertCurrentTemplateVersionIsRegistered` in `core/templates.js`,
    // invoked from `core/plugin.js`); the older entries stay registered
    // so historical items keep rendering exactly as they were assessed.
    registerModuleDetailTemplates('re-accreditation', {
      v1: 're-accreditation/detail-v1',
      v2: 're-accreditation/detail-v1',
      v3: 're-accreditation/detail-v1',
      v4: 're-accreditation/detail-v1',
      v5: 're-accreditation/detail-v1',
      v6: 're-accreditation/detail-v1',
      v7: 're-accreditation/detail-v1',
      v8: 're-accreditation/detail-v1',
      v9: 're-accreditation/detail-v1',
      v10: 're-accreditation/detail-v1'
    })

    // RA-132. Approve-determination flow: confirmation interstitial + POST
    // handler that hits the type-specific backend endpoint. Always mounted
    // — the FE button only renders when the work item is eligible, and
    // the backend is the source of truth for authorisation.
    server.route(buildApprovalRoutes())

    // RA-372. Continue-review flow: the onward path out of `updated` once
    // a case worker has reviewed an operator's response to a query. Hits
    // the type-specific backend endpoint because the underlying
    // `continue-review-during-*` transitions are not caller-invocable —
    // see the TRANSITIONS comment above. Always mounted; the CTA only
    // renders for a work item actually in `updated`.
    server.route(buildContinueReviewRoutes())

    // RA-127. The create-work-item demo form is feature-flagged so it
    // can be hidden in production. When the flag is off the routes are
    // not mounted at all — the page is a 404 rather than an explicit
    // "feature disabled" page.
    if (config.get('featureFlags.workItemCreationEnabled')) {
      server.route(buildCreateWorkItemRoutes())
    }
  }
}
