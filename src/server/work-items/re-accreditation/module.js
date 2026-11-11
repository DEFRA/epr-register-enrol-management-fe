import { config } from '#/config/config.js'
import { registerModuleDetailTemplates } from '../core/templates.js'
import { buildChangePaymentDateRoutes } from './change-payment-date/routes.js'
import { buildContinueReviewRoutes } from './continue-review/routes.js'
import { buildCreateWorkItemRoutes } from './create/routes.js'
import { buildConfirmContactRoutes } from './confirm-contact/routes.js'
import { buildDecisionRoutes } from './decision/routes.js'
import { buildDulyMakingRoutes } from './duly-making/routes.js'
import { standardWorkflow } from '../core/standard-workflow.js'

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

const DETAIL_TEMPLATE_V1 = 're-accreditation/detail-v1'

export const reAccreditationType = {
  id: 're-accreditation',
  displayName: 'Re-accreditation',
  // Mirrors `ReAccreditationType.TemplateVersion` in the backend, which is
  // the value actually stamped onto work items. Keep the two in lock-step
  // and add the matching entry to the detail-template map below.
  templateVersion: 'v18',
  // RA-739. Re-accreditation follows the shared Standard workflow.
  initialState: standardWorkflow.initialState,
  states: standardWorkflow.states,
  transitions: standardWorkflow.transitions
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
    // v18: RA-527 follow-up backend added the non-terminal
    //      `assessment-started` state ("Duly made"), retargeted
    //      `start-assessment` to it and added `submit-for-decision`,
    //      `query-during-assessment` and `withdraw-during-assessment` from
    //      it, so starting a case keeps it "Duly made"; and `sla-extend`
    //      from it to `assessment-in-progress` (not caller-invocable), so a
    //      deadline change on a started case still ends at "Updated".
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
      v17: DETAIL_TEMPLATE_V1,
      v18: DETAIL_TEMPLATE_V1
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

    // RA-576. Change-payment-date flow: corrects the payment date entered at
    // duly making without moving the application's status or SLA clock. Hits
    // the type-specific `/change-payment-date` endpoint. Always mounted; the
    // side-panel link only renders, and both handlers only proceed, for a
    // work item that is eligible (`evaluateChangePaymentDateEligibility`).
    server.route(buildChangePaymentDateRoutes())

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
