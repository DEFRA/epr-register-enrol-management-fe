import { config } from '#/config/config.js'
import { registerModuleDetailTemplates } from '../core/templates.js'
import { buildContinueReviewRoutes } from './continue-review/routes.js'
import { buildCreateWorkItemRoutes } from './create/routes.js'
import { buildConfirmContactRoutes } from './confirm-contact/routes.js'
import { buildDecisionRoutes } from './decision/routes.js'
import { buildDulyMakingRoutes } from './duly-making/routes.js'
import {
  STATE_APPROVED_PENDING_CONTACT,
  STATE_REJECTED_PENDING_CONTACT
} from './states.js'

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

// State ids shared with the backend's `ReAccreditationType` — never renamed.
const STATE_ASSESSMENT_IN_PROGRESS = 'assessment-in-progress'
const STATE_AWAITING_DECISION = 'awaiting-decision'

// Shared task display name and the single detail template every current
// template version renders with.
const CONTINUE_REVIEW_DISPLAY_NAME = 'Continue review'
const DETAIL_TEMPLATE_V1 = 're-accreditation/detail-v1'

const STATES = [
  { id: 'submitted', displayName: 'Not started' },
  { id: 'duly-made', displayName: 'Duly made' },
  { id: STATE_ASSESSMENT_IN_PROGRESS, displayName: 'Updated' },
  { id: STATE_AWAITING_DECISION, displayName: 'Awaiting decision' },
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
  // RA-527 (management-be v17). Step 1 of the two-step determination: the
  // regulator has approved and the accreditation number is minted, but the
  // applicant has not been contacted, so nothing is applied yet. Deliberately
  // NOT terminal. The "Approved" label is provisional — keep it to this one
  // entry (it mirrors the backend's display name).
  { id: STATE_APPROVED_PENDING_CONTACT, displayName: 'Approved' },
  { id: 'approved', displayName: 'Granted', isTerminal: true },
  // RA-527 (management-be v17). Step 1 of a refusal: refused, no number
  // minted, the applicant not yet contacted. NOT terminal. The "Refusing"
  // label is provisional — keep it to this one entry (it mirrors the
  // backend's display name).
  { id: STATE_REJECTED_PENDING_CONTACT, displayName: 'Refusing' },
  { id: 'rejected', displayName: 'Refused', isTerminal: true },
  { id: 'withdrawn', displayName: 'Withdrawn', isTerminal: true }
]

const TRANSITIONS = [
  // RA-316. The first step of the lifecycle: a regulator records the date
  // the payment was received and the application becomes duly made. It
  // STAYS in `duly-made` — nothing in RA-316 moves it on.
  //
  // `callerInvocable: false` mirrors the backend's `CallerInvocable: false`
  // and is load-bearing in two directions. It keeps `projectWorkItem` from
  // offering `duly-make` in `availableActions`, which matters because the
  // generic `POST /work-items/{id}/actions/{actionId}` route has nowhere
  // to put the payment date — a generic button would post an actionless
  // request the backend would reject. And it is why the CTA cannot be
  // gated through `core/engine.js#canApplyAction`, which refuses any
  // transition declared this way: see `duly-making/eligibility.js`, which
  // reads THIS declaration's `fromStateId` so the `submitted` literal
  // lives here and only here.
  {
    actionId: 'duly-make',
    displayName: 'Duly make',
    fromStateId: 'submitted',
    toStateId: 'duly-made',
    callerInvocable: false
  },
  // RA-410 / RA-595. `startsOnSelfAssign: true` is what makes "Assign to
  // yourself and start" actually start anything. The generic self-assign handler reads
  // this marker via `core/engine.js#resolveSelfAssignTransition` and applies
  // the transition after the assignment, so the second half of that button's
  // label stops being a lie without the generic layer learning what a
  // re-accreditation is.
  //
  // The marker is paired with `fromStateId` by the resolver, which is
  // load-bearing: the assignment panel renders in EVERY state (RA-295), so
  // self-assigning a `queried` or `awaiting-decision` item must remain a
  // plain assignment with no state change. Only `duly-made` transitions.
  //
  // Still caller-invocable, deliberately: the marker also keeps it out of
  // the actions list (see `selfAssignActionIds` in detail.controller.js),
  // and both the self-assign handler and `core/ensure-assessment-started.js`
  // (behind the Make Determination and Change determination deadline
  // submits) apply it through the generic action route, as the backend's
  // own contract describes it.
  //
  // RA-595 (add / switch / remove). This used to be `payment-received`;
  // management-be v15 added `start-assessment` ("Assessment started") with
  // the same from/to states, this frontend switched to it, and v16 removed
  // `payment-received` from both tiers.
  {
    actionId: 'start-assessment',
    displayName: 'Assessment started',
    fromStateId: 'duly-made',
    toStateId: STATE_ASSESSMENT_IN_PROGRESS,
    startsOnSelfAssign: true,
    // RA-595. Appended to the self-assign banner when the assign half lands
    // and this start does not. There is no separate start control to retry
    // with; the determination and deadline submits start the case.
    startRetryHint:
      'It will be started when you make a determination or change the determination deadline.'
  },
  {
    actionId: 'sla-extend',
    // RA-447 CM5. `sla-extend` is filtered out of `availableActions` before
    // this reaches a template (see the RA-372 note in
    // `work-items/detail.njk`), so this displayName is never rendered.
    // RA-572 reworded the PAGE from "Extend" to "Change" but deliberately
    // left this string alone: it mirrors management-be's transition
    // declaration, which RA-572 does not touch, and a declaration that
    // silently disagrees with the backend is worse than one that disagrees
    // with copy it never renders. The user-facing wording lives in
    // `routes/work-items/detail.njk` and `routes/work-items/sla-extend.njk`.
    displayName: 'Extend determination deadline',
    fromStateId: STATE_ASSESSMENT_IN_PROGRESS,
    toStateId: STATE_ASSESSMENT_IN_PROGRESS
  },
  // RA-351. A queried application can ALSO change its determination
  // deadline (RA-572 retired the Override affordance that used to ride on
  // the same `canChangeDueDate` flag) — management-be projects
  // `sla-extend` into a queried item's `availableActions`, so a queried
  // item's projected actions are `['sla-extend', 'withdraw-during-query']`.
  //
  // There is deliberately NO second `sla-extend` transition entry here for
  // the `queried` self-loop, even though the backend's transition set has
  // one. The FE framework's `assertValidWorkItemModule`
  // (core/module.js) enforces GLOBALLY-UNIQUE transition `actionId`s — an
  // invariant `engine.js#canApplyAction`'s find-by-actionId relies on — so a
  // second `sla-extend` cannot be expressed in this list. It does not need
  // to be: `canChangeDueDate` (detail.controller.js) derives from the
  // backend-projected `availableActions`, never from this transitions
  // array, so both due-date links render on a queried item the instant the
  // backend projects the action. The mirror is complete for every purpose
  // the frontend reads it for.
  //
  // RA-595 adds one frontend-only exception: `canChangeDueDate` is also true
  // on a `duly-made` item (the `startsOnSelfAssign` from-state), where the
  // backend projects no `sla-extend`. The deadline submit starts assessment
  // first, so the backend never sees `sla-extend` from `duly-made`.

  // RA-410. `submit-for-decision` and `reject` (below) both became
  // NON-caller-invocable in v12, mirroring management-be. Neither is a
  // button any more: both hops are applied server-side by the single
  // `POST /work-items/re-accreditation/{id}/decision` call behind the "Log
  // decision" CTA, so `awaiting-decision` is now an internal staging post
  // rather than somewhere a case worker parks an application.
  //
  // The flag is what stops the generic action loop rendering them. That
  // matters most for `submit-for-decision`: a button that moved an item to
  // `awaiting-decision` and stopped would strand it, because the Log
  // decision CTA renders from `assessment-in-progress`. (It also renders
  // from `awaiting-decision` — see `decision/eligibility.js` — precisely so
  // items already parked there when this shipped are still resolvable, but
  // that is a rescue path, not an invitation to create more.)
  {
    actionId: 'submit-for-decision',
    displayName: 'Submit for decision',
    fromStateId: STATE_ASSESSMENT_IN_PROGRESS,
    toStateId: STATE_AWAITING_DECISION,
    callerInvocable: false
  },
  // RA-527 (management-be v17). Step 1 of an approval: awaiting-decision ->
  // approved-pending-contact. It replaced the frontend-only `approve` entry
  // RA-346/RA-410 kept here, so this list is now a one-for-one mirror of the
  // backend's declaration again (`approve` was never a backend transition;
  // `make-determination-approved` is).
  //
  // Not decorative: `decision/eligibility.js` reads this declaration (and
  // `make-determination-rejected` below) to resolve which state a decision is
  // taken from and where each radio choice lands, so those literals live here
  // and only here.
  //
  // `callerInvocable: false`, like the refusal's step 1: neither is reachable
  // through the generic `/actions/{actionId}` route, only through
  // `POST /work-items/re-accreditation/{id}/decision`, which mints the
  // accreditation number in the same write.
  {
    actionId: 'make-determination-approved',
    displayName: 'Make determination: Approved',
    fromStateId: STATE_AWAITING_DECISION,
    toStateId: STATE_APPROVED_PENDING_CONTACT,
    callerInvocable: false
  },
  // RA-527 (management-be v17). Step 2 of an approval ("confirm applicant
  // contact"): approved-pending-contact -> approved. `callerInvocable: false`
  // like step 1: only `POST /work-items/re-accreditation/{id}/confirm-contact`
  // reaches it, because the backend pushes the outcome to the operator
  // journey before the write. The confirm page's own route guard reads the
  // pending state from `states.js`, not from this declaration.
  {
    actionId: 'confirm-contact-approved',
    displayName: 'Confirm applicant contact',
    fromStateId: STATE_APPROVED_PENDING_CONTACT,
    toStateId: 'approved',
    callerInvocable: false
  },
  // RA-527 (management-be v17). A refusal takes the same two steps. Step 1:
  // awaiting-decision -> rejected-pending-contact (no number is minted).
  // It replaced the single-step `reject` (awaiting-decision -> rejected),
  // which the backend removed from v17, so nothing refuses an application
  // without both steps. `callerInvocable: false`: only
  // `POST /work-items/re-accreditation/{id}/decision` reaches it.
  {
    actionId: 'make-determination-rejected',
    displayName: 'Make determination: Refused',
    fromStateId: STATE_AWAITING_DECISION,
    toStateId: STATE_REJECTED_PENDING_CONTACT,
    callerInvocable: false
  },
  // RA-527 (management-be v17). Step 2 of a refusal ("confirm applicant
  // contact"): rejected-pending-contact -> rejected. Only
  // `POST /work-items/re-accreditation/{id}/confirm-contact` reaches it.
  {
    actionId: 'confirm-contact-rejected',
    displayName: 'Confirm applicant contact',
    fromStateId: STATE_REJECTED_PENDING_CONTACT,
    toStateId: 'rejected',
    callerInvocable: false
  },
  {
    actionId: 'withdraw',
    displayName: 'Withdraw',
    fromStateId: 'submitted',
    toStateId: 'withdrawn'
  },
  {
    actionId: 'withdraw-during-duly-made',
    displayName: 'Withdraw',
    fromStateId: 'duly-made',
    toStateId: 'withdrawn'
  },
  {
    actionId: 'withdraw-during-assessment',
    displayName: 'Withdraw',
    fromStateId: STATE_ASSESSMENT_IN_PROGRESS,
    toStateId: 'withdrawn'
  },
  {
    actionId: 'withdraw-during-decision',
    displayName: 'Withdraw',
    fromStateId: STATE_AWAITING_DECISION,
    toStateId: 'withdrawn'
  },
  {
    actionId: 'withdraw-during-query',
    displayName: 'Withdraw',
    fromStateId: 'queried',
    toStateId: 'withdrawn'
  },
  {
    actionId: 'withdraw-during-updated',
    displayName: 'Withdraw',
    fromStateId: 'updated',
    toStateId: 'withdrawn'
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
    toStateId: 'queried'
  },
  {
    actionId: 'query-during-duly-made',
    displayName: 'Query',
    fromStateId: 'duly-made',
    toStateId: 'queried'
  },
  {
    actionId: 'query-during-assessment',
    displayName: 'Query',
    fromStateId: STATE_ASSESSMENT_IN_PROGRESS,
    toStateId: 'queried'
  },
  {
    actionId: 'query-during-decision',
    displayName: 'Query',
    fromStateId: STATE_AWAITING_DECISION,
    toStateId: 'queried'
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
    callerInvocable: false
  },
  // RA-523 (management-be v14). The exception to "into `updated`": a case
  // queried from Duly made already has its payment and SLA clock settled,
  // so the operator's response returns it straight to assessment, with the
  // querier re-assigned.
  {
    actionId: 'resume-during-duly-made',
    displayName: 'Resume',
    fromStateId: 'queried',
    toStateId: STATE_ASSESSMENT_IN_PROGRESS,
    callerInvocable: false
  },
  {
    actionId: 'resume-during-assessment',
    displayName: 'Resume',
    fromStateId: 'queried',
    toStateId: 'updated',
    callerInvocable: false
  },
  {
    actionId: 'resume-during-decision',
    displayName: 'Resume',
    fromStateId: 'queried',
    toStateId: 'updated',
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
    displayName: CONTINUE_REVIEW_DISPLAY_NAME,
    fromStateId: 'updated',
    toStateId: 'submitted',
    callerInvocable: false
  },
  {
    actionId: 'continue-review-during-duly-made',
    displayName: CONTINUE_REVIEW_DISPLAY_NAME,
    fromStateId: 'updated',
    toStateId: 'duly-made',
    callerInvocable: false
  },
  {
    actionId: 'continue-review-during-assessment',
    displayName: CONTINUE_REVIEW_DISPLAY_NAME,
    fromStateId: 'updated',
    toStateId: STATE_ASSESSMENT_IN_PROGRESS,
    callerInvocable: false
  },
  {
    actionId: 'continue-review-during-decision',
    displayName: CONTINUE_REVIEW_DISPLAY_NAME,
    fromStateId: 'updated',
    toStateId: STATE_AWAITING_DECISION,
    callerInvocable: false
  }
]

export const reAccreditationType = {
  id: 're-accreditation',
  displayName: 'Re-accreditation',
  // Mirrors `ReAccreditationType.TemplateVersion` in the backend, which is
  // the value actually stamped onto work items. Keep the two in lock-step
  // and add the matching entry to the detail-template map below.
  templateVersion: 'v17',
  initialState: STATES[0],
  states: STATES,
  transitions: TRANSITIONS
  // RA-410. `getTasksForState` and the `TASKS_BY_STATE` map it read are
  // gone. The framework no longer asks a type for tasks — `IWorkItemType`
  // lost the member backend-side and `core/engine.js#projectWorkItem` no
  // longer calls it. Do not re-add it to reintroduce a checklist.
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
    // v11: RA-316 duly-make transition out of 'submitted', and the two
    //      'submitted' tasks removed (the auto-transition they drove is
    //      gone from the backend too)
    // v12: RA-410 tasks removed entirely — `getTasksForState` and every
    //      `requiresAllTasksComplete` gate deleted, and
    //      `submit-for-decision` / `reject` made non-caller-invocable
    //      (both hops now applied server-side by the `/decision` endpoint
    //      behind the Log decision CTA)
    // v13: RA-351 backend added an `sla-extend` self-loop on `queried` so a
    //      queried item projects the action into its `availableActions`
    //      (making the Extend/Override due-date links available while an
    //      application waits on a query). management-be bumps v12 -> v13 with
    //      a ReAccreditationSlaExtendQuerySnapshotMigration. Not mirrored as
    //      a transition here — the FE keys transition `actionId`s uniquely
    //      and already has an `sla-extend` self-loop on
    //      `assessment-in-progress`; the queried affordance rides
    //      `canChangeDueDate` off the backend projection, not this list
    //      (see the `sla-extend` transition comment above).
    // v15: RA-595 backend added `start-assessment` ("Assessment started",
    //      duly-made -> assessment-in-progress) beside `payment-received`,
    //      with a ReAccreditationStartAssessmentSnapshotMigration. The
    //      self-assign start step moved onto it (see TRANSITIONS above).
    // v16: RA-595 backend removed `payment-received`, with a
    //      ReAccreditationRemovePaymentReceivedSnapshotMigration. Its
    //      retired (non-invocable) declaration here went with it.
    // v17: RA-527 backend added the non-terminal `approved-pending-contact`
    //      state, the `make-determination-approved` step 1 transition into
    //      it and the `confirm-contact-approved` step 2 transition out of
    //      it, with a ReAccreditationPendingContactSnapshotMigration; then
    //      (still unreleased, so in v17) the refusal half: the non-terminal
    //      `rejected-pending-contact` state, `make-determination-rejected`
    //      and `confirm-contact-rejected`, removing the single-step `reject`.
    //
    // ⚠ RA-316. v10 MUST STAY REGISTERED PERMANENTLY, not just through the
    // release. The backend's snapshot migration restamps live items to v11
    // but runs at startup and is fault-tolerant — a failure logs a warning
    // and retries next boot — so there is a window in which live items are
    // still stamped v10, and an unregistered v10 would drop every one of
    // them onto the GENERIC detail template (losing this type's actions
    // panel and the Duly make CTA) with nothing logged. Confirmed with
    // management-be.
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
      v1: DETAIL_TEMPLATE_V1,
      v2: DETAIL_TEMPLATE_V1,
      v3: DETAIL_TEMPLATE_V1,
      v4: DETAIL_TEMPLATE_V1,
      v5: DETAIL_TEMPLATE_V1,
      v6: DETAIL_TEMPLATE_V1,
      v7: DETAIL_TEMPLATE_V1,
      v8: DETAIL_TEMPLATE_V1,
      v9: DETAIL_TEMPLATE_V1,
      v10: DETAIL_TEMPLATE_V1,
      v11: DETAIL_TEMPLATE_V1,
      v12: DETAIL_TEMPLATE_V1,
      v13: DETAIL_TEMPLATE_V1,
      v14: DETAIL_TEMPLATE_V1,
      v15: DETAIL_TEMPLATE_V1,
      v16: DETAIL_TEMPLATE_V1,
      v17: DETAIL_TEMPLATE_V1
    })

    // RA-372. Continue-review flow: the onward path out of `updated` once
    // a case worker has reviewed an operator's response to a query. Hits
    // the type-specific backend endpoint because the underlying
    // `continue-review-during-*` transitions are not caller-invocable —
    // see the TRANSITIONS comment above. Always mounted; the CTA only
    // renders for a work item actually in `updated`.
    server.route(buildContinueReviewRoutes())

    // RA-316. Duly-making flow: the payment-date page and its POST
    // handler. Hits the type-specific backend endpoint because
    // `duly-make` is declared non-caller-invocable and carries a payment
    // date the generic action route cannot express — see the TRANSITIONS
    // comment above. Always mounted; the CTA only renders for a work item
    // actually in `submitted`, and both the CTA and the GET handler go
    // through the same `evaluateDulyMakeEligibility` gate.
    server.route(buildDulyMakingRoutes())

    // RA-410. Log-decision flow: the Approved / Refused radio page and its
    // POST handler, replacing the task-gated approve interstitial as the
    // way a case worker records an outcome. Hits the type-specific
    // `/decision` endpoint, which applies BOTH hops
    // (`assessment-in-progress` -> `awaiting-decision` -> terminal) in one
    // server-side write — deliberately not two calls from here, because a
    // failure between them would leave a terminal decision unrecorded with
    // the item parked in a state the new UI no longer offers a button for.
    //
    // Always mounted; the CTA and the GET handler share one eligibility
    // gate so the button and the URL cannot disagree.
    server.route(buildDecisionRoutes())

    // RA-527. Confirm-contact flow: step 2 of the two-step determination.
    // The page and its POST handler, which calls the type-specific
    // `/confirm-contact` endpoint to apply the outcome step 1 recorded.
    // Always mounted; the CTA only renders, and both handlers only proceed,
    // for a work item actually pending contact.
    server.route(buildConfirmContactRoutes())

    // RA-127. The create-work-item demo form is feature-flagged so it
    // can be hidden in production. When the flag is off the routes are
    // not mounted at all — the page is a 404 rather than an explicit
    // "feature disabled" page.
    if (config.get('featureFlags.workItemCreationEnabled')) {
      server.route(buildCreateWorkItemRoutes())
    }
  }
}
