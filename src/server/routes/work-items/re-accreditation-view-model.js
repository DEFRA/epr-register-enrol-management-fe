import { RE_ACCREDITATION_TYPE_ID } from '#/server/work-items/re-accreditation/type-id.js'
import { evaluateChangePaymentDateEligibility } from '#/server/work-items/re-accreditation/change-payment-date/eligibility.js'
import {
  isContinueReviewState,
  canQueryWorkItem,
  isPreDulyMadeWaypoint
} from './re-accreditation-cta.js'
import { buildDecisionMetadata } from './re-accreditation-decision-metadata.js'
import { buildStandardLifecycleFields } from './standard-lifecycle-view-model.js'

// RA-132. ----------------------------------------------------------------
// Re-accreditation-specific UI decoration.
//
// The generic decorator stays free of per-type rules. This helper layers
// in three things on top of an already-decorated work item, only when its
// `typeId` is `re-accreditation`:
//
//  - `canLogDecision` — whether the primary "Log decision" CTA should
//    render. RA-323: any caseworker may decide, so this is purely an
//    eligibility check. The backend remains authoritative; a forged POST is
//    still rejected there.
//
//    RA-410: replaced `canApproveDirectly`. One CTA now covers both
//    outcomes, and it renders from `assessment-in-progress` as well as
//    `awaiting-decision` — see `decision/eligibility.js` for why both entry
//    states are allowed. The decision route guards itself with the same
//    helper, so the button and the URL cannot disagree.
//
//    RA-595: it also renders from `duly-made`, whoever holds the case. That
//    is a frontend-only rule (the backend lists no decision action there);
//    the decision submit runs `core/ensure-assessment-started.js` first.
//  - `logDecisionHref` — link target for the CTA.
//  - `canContinueReview` + `continueReviewHref` (RA-372) — whether the
//    "Continue review" CTA should render, and where it posts. The endpoint
//    is protected by plain authentication — no `assign` role, no
//    assigned-officer check. The backend remains authoritative.
//
//    RA-410: this used to read the generic `isTaskWaypoint` flag, which
//    `decorate` derived from `taskStateId`. Both are gone. It now reads the
//    `continue-review-during-*` transitions' own `fromStateId` from the
//    module declaration, so the `updated` literal STILL lives only in
//    `re-accreditation/module.js` and a change there moves the CTA with it.
//    This is not a task feature and must keep working — it is the only path
//    out of `updated`.
//  - `canQuery` (RA-000) — whether the Query link renders. Read off the
//    module's `query-during-*` declarations (`evaluateQueryEligibility`), because the
//    backend does not project those non-caller-invocable transitions. The
//    query endpoint remains authoritative.
//  - `isReadOnlyState` + `stateTagClasses` — once the work item reaches
//    a terminal state (approved / rejected / withdrawn), the template
//    suppresses the generic action panel and shows a status tag.
//  - `decisionMetadata` — for approved work items, the issued
//    accreditation id + a GOV.UK formatted start date for display.
// -----------------------------------------------------------------------
export function applyReAccreditationViewModel({
  workItem,
  source = workItem,
  route
}) {
  if (workItem.typeId !== RE_ACCREDITATION_TYPE_ID) {
    return workItem
  }

  // RA-576. Same discipline: the raw DTO, through the helper the change
  // page's own route guard uses. Hidden for terminal items and for items
  // with no payment date to change.
  const canChangePaymentDate =
    evaluateChangePaymentDateEligibility(source).allowed

  // RA-372 / RA-410. Read off the module's own `continue-review-during-*`
  // declarations rather than testing for `'updated'` here, so that literal
  // stays in `re-accreditation/module.js`. All four share
  // `fromStateId: 'updated'`, so "is this item in the state those
  // transitions leave from" is exactly "should Continue review render".
  //
  // Replaces the old `isTaskWaypoint` derivation, which read `taskStateId`
  // — a field RA-410 removed. The CTA itself is unchanged.
  // RA-454. A query raised BEFORE duly making leaves the item in `updated`
  // with `originStateId: 'submitted'`, so both this CTA and Duly make would
  // otherwise fire. Continue review is only meaningful once there IS a review
  // to resume — i.e. the query was raised from `duly-made` /
  // `assessment-in-progress` / `awaiting-decision`, never from `submitted`.
  // Suppress it for the pre-duly-made waypoint so only Duly make shows.
  //
  // RA-523. A duly-made-origin item queried while it awaited payment no
  // longer reaches `updated` at all: the backend's `resume-during-duly-made`
  // transition now retargets straight to `assessment-in-progress`, so it
  // arrives decision-ready with no onward CTA and needs no carve-out here.
  // The remaining `updated` origins — `submitted` (excluded above),
  // `assessment-in-progress` and `awaiting-decision` — still fall through
  // to Continue review. That fall-through is the whole regression risk on
  // this ticket and is covered per-origin in the tests.
  const canContinueReview =
    isContinueReviewState(source?.stateId) &&
    !isPreDulyMadeWaypoint(source?.originStateId)

  const decisionMetadata = buildDecisionMetadata(workItem)

  return {
    ...workItem,
    // RA-495. Duly make, Make Determination, the pending-contact banner and
    // Confirm applicant contact, and the read-only Outcome panel: the shared
    // Standard-lifecycle fields. Gated on `source` (the raw backend DTO),
    // never on `workItem` — see the call site in `detail.controller.js`.
    // Only an approval has an accreditation ID to show (decision metadata is
    // never built for a refusal).
    ...buildStandardLifecycleFields({
      workItem,
      source,
      accreditationId: decisionMetadata?.accreditationId ?? null
    }),
    canChangePaymentDate,
    changePaymentDateHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/change-payment-date`,
    canContinueReview,
    // RA-000. The Query link — see `evaluateQueryEligibility`.
    canQuery: canQueryWorkItem(source, { route }),
    continueReviewHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/continue-review`,
    decisionMetadata
  }
}
