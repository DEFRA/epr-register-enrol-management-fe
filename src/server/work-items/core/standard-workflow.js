/**
 * RA-739. The Standard workflow: duly making, assessment, query and response,
 * the two-step determination and withdrawal. It was re-accreditation's state
 * machine and mirrors management-be's `StandardWorkflow`, which both
 * re-accreditation and add-ORS (`add-overseas-site`) reference. Declared once
 * here so every type that follows it shares the same state labels and
 * transitions. The comments below name re-accreditation's routes, which are
 * the only ones that reach its non-caller-invocable transitions today.
 */

// RA-324. State DisplayNames are aligned with the Applications-page label
// contract and mirror the backend's rename byte-for-byte. The state *ids* are
// unchanged (they are the shared wire contract); only the human labels move,
// so no templateVersion bump is required for the rename itself. Note the
// intentional collision: both `assessment-in-progress` and `updated` display
// as "Updated" (literal AC06, confirmed with the backend — do not reconcile).

// State ids shared with the backend's `StandardWorkflow` — never renamed.

/**
 * RA-527. Step 1 of the two-step determination: approved and the
 * accreditation number minted, but the applicant not yet contacted. Not
 * terminal.
 */
export const STATE_APPROVED_PENDING_CONTACT = 'approved-pending-contact'

/**
 * RA-527. Step 1 of the two-step determination for a refusal: refused (no
 * number is minted), but the applicant not yet contacted. Not terminal.
 */
export const STATE_REJECTED_PENDING_CONTACT = 'rejected-pending-contact'

const STATE_ASSESSMENT_IN_PROGRESS = 'assessment-in-progress'
const STATE_ASSESSMENT_STARTED = 'assessment-started'
const STATE_AWAITING_DECISION = 'awaiting-decision'

// Shared task display name.
const CONTINUE_REVIEW_DISPLAY_NAME = 'Continue review'

const STATES = [
  { id: 'submitted', displayName: 'Not started' },
  { id: 'duly-made', displayName: 'Duly made' },
  // RA-527 follow-up (management-be v18). A Duly made case a regulator has
  // started work on ("Assessment started"). It reads "Duly made", exactly
  // like `duly-made`: starting a case is not a response to anything, so
  // "Updated" is kept for a query response or a deadline change. Declared
  // straight after `duly-made`, mirroring the backend, whose status sort rank
  // is the declaration order.
  { id: STATE_ASSESSMENT_STARTED, displayName: 'Duly made' },
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
  // NOT terminal. The label mirrors the backend's display name.
  { id: STATE_APPROVED_PENDING_CONTACT, displayName: 'Approved' },
  { id: 'approved', displayName: 'Granted', isTerminal: true },
  // RA-527 (management-be v17). Step 1 of a refusal: refused, no number
  // minted, the applicant not yet contacted. NOT terminal. It reads
  // "Refused", the same as the final `rejected` state (user decision,
  // 2026-10-22). The label mirrors the backend's display name.
  { id: STATE_REJECTED_PENDING_CONTACT, displayName: 'Refused' },
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
  //
  // RA-527 follow-up (management-be v18). Retargeted to `assessment-started`
  // ("Duly made"), so starting a case no longer shows "Updated". The
  // from-state is unchanged, so self-assign and "ensure assessment started"
  // still start only from `duly-made`; from `assessment-started` self-assign
  // is a plain assignment.
  {
    actionId: 'start-assessment',
    displayName: 'Assessment started',
    fromStateId: 'duly-made',
    toStateId: STATE_ASSESSMENT_STARTED,
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
  //
  // RA-527 follow-up (management-be v18) adds a THIRD backend `sla-extend`:
  // `assessment-started` -> `assessment-in-progress`, a real move to
  // "Updated", not caller-invocable (only the deadline endpoint applies it),
  // so it is never projected. It cannot be mirrored here either (unique
  // action ids), so `canChangeDueDate` is also true on the state
  // `start-assessment` lands on, read off its `toStateId`.

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
  //
  // RA-527 follow-up (management-be v18). The backend ALSO declares
  // `submit-for-decision` from `assessment-started` (same action id, still
  // not caller-invocable), so a determination works from a started case.
  // As with the second `sla-extend` above, that second entry cannot be
  // expressed here: `assertValidWorkItemModule` requires globally-unique
  // action ids. It does not need to be: the only reader of this declaration's
  // from-state is `decision/eligibility.js`, which also accepts the state
  // `start-assessment` lands on (read off that transition's `toStateId`), so
  // the Make determination CTA is offered on a started case.
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
  // RA-527 follow-up (management-be v18). The backend ALSO declares
  // `withdraw-during-assessment` from `assessment-started` (same action id),
  // so an operator can withdraw a started case. That second entry cannot be
  // expressed here (`assertValidWorkItemModule` requires globally-unique
  // action ids), and does not need to be: withdraw is an operator action
  // that the Case Management service never offers (RA-317,
  // `routes/work-items/detail.controller.js` strips every `withdraw-*`).
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
  // pre-decision state. There is deliberately no transition out of
  // `queried` back to `queried` — an application awaiting a response cannot
  // be queried again.
  //
  // RA-000 (management-be v19). `callerInvocable: false`, mirroring the
  // backend. A query is applied ONLY by the backend's query service (behind
  // `POST /work-items/{id}/query` here), which self-assigns, stamps
  // `currentQuery` and writes the `application-queried` audit entry; the
  // operator push and the Queried email read that stamp. Applied through the
  // generic `/actions/{actionId}` route, all three were skipped and the push
  // sent an empty or a previous query. The backend therefore no longer
  // projects these into `availableActions`, so the Query link and the query
  // page are gated by `isQueryState` (`routes/work-items/re-accreditation-cta.js`),
  // which reads the `fromStateId`s below.
  {
    actionId: 'query-during-duly-making',
    displayName: 'Query',
    fromStateId: 'submitted',
    toStateId: 'queried',
    callerInvocable: false
  },
  {
    actionId: 'query-during-duly-made',
    displayName: 'Query',
    fromStateId: 'duly-made',
    toStateId: 'queried',
    callerInvocable: false
  },
  // RA-527 follow-up (management-be v18). The backend ALSO declares
  // `query-during-assessment` from `assessment-started` (same action id), so
  // a started case can be queried. Its response and Continue review then
  // follow the assessment route: `updated`, then `assessment-in-progress`,
  // never back to `assessment-started`. As with the extra `sla-extend` and
  // `submit-for-decision` above, that second entry cannot be expressed here
  // (`assertValidWorkItemModule` requires globally-unique action ids), so
  // `isQueryState` adds the state the `startsOnSelfAssign` transition lands
  // on (`core/engine.js#resolveActionEntryStates`), the same helper
  // `decision/eligibility.js` uses for the second `submit-for-decision`.
  {
    actionId: 'query-during-assessment',
    displayName: 'Query',
    fromStateId: STATE_ASSESSMENT_IN_PROGRESS,
    toStateId: 'queried',
    callerInvocable: false
  },
  {
    actionId: 'query-during-decision',
    displayName: 'Query',
    fromStateId: STATE_AWAITING_DECISION,
    toStateId: 'queried',
    callerInvocable: false
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
  // `StandardWorkflow` transitions, and should be kept that way.
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

/** The Standard workflow, referenced by every type that follows it. */
export const standardWorkflow = Object.freeze({
  id: 'standard',
  initialState: STATES[0],
  states: STATES,
  transitions: TRANSITIONS
})
