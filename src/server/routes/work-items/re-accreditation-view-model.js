import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import {
  evaluateLogDecisionEligibility,
  RE_ACCREDITATION_TYPE_ID
} from '#/server/work-items/re-accreditation/decision/eligibility.js'
import { evaluateDulyMakeEligibility } from '#/server/work-items/re-accreditation/duly-making/eligibility.js'
import { evaluateChangePaymentDateEligibility } from '#/server/work-items/re-accreditation/change-payment-date/eligibility.js'
import {
  PENDING_CONTACT_STATE_IDS,
  STATE_APPROVED_PENDING_CONTACT,
  STATE_REJECTED_PENDING_CONTACT
} from '#/server/work-items/re-accreditation/states.js'
import {
  isContinueReviewState,
  canQueryWorkItem,
  isPreDulyMadeWaypoint
} from './re-accreditation-cta.js'
import { TERMINAL_STATE_IDS } from './assignment-view-model.js'
import { buildDecisionMetadata } from './re-accreditation-decision-metadata.js'

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
// RA-527. The persistent banner on a determination awaiting applicant
// contact, keyed by pending state. The refusal copy is provisional (it
// extrapolates Design 3's approval-only screens) — keep it to this entry.
const PENDING_CONTACT_BANNERS = Object.freeze({
  [STATE_APPROVED_PENDING_CONTACT]: Object.freeze({
    title: 'Application approved',
    text: 'The application was approved. You now need to contact the applicant about the decision.'
  }),
  [STATE_REJECTED_PENDING_CONTACT]: Object.freeze({
    title: 'Application refused',
    text: 'The application was refused. You now need to contact the applicant about the decision.'
  })
})

export function applyReAccreditationViewModel({
  workItem,
  source = workItem,
  route
}) {
  if (workItem.typeId !== RE_ACCREDITATION_TYPE_ID) {
    return workItem
  }

  // Gate on `source` (the raw backend DTO), never on `workItem` (the
  // decorated view model) — see the call site in `detail.controller.js` for
  // why. The flag is then merged into the view model below.
  const canLogDecision = evaluateLogDecisionEligibility(source).allowed

  // RA-316. Same discipline as the approve gate: evaluated against
  // `source` (the raw backend DTO), and through the SAME helper the
  // duly-making route guards itself with, so the CTA and the URL cannot
  // disagree. The `submitted` state rule lives in the module's `duly-make`
  // transition declaration, not here.
  const canDulyMake = evaluateDulyMakeEligibility(source).allowed

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

  const isReadOnlyState = TERMINAL_STATE_IDS.has(workItem.stateId)
  // RA-324 (AC08). Source the terminal "Outcome" tag colour from the shared
  // state-badge map so it matches the list and the envelope State badge.
  const stateTagClasses = stateTagClass(workItem.stateId)

  const decisionMetadata = buildDecisionMetadata(workItem)

  // RA-527. Step 1 of the determination is done but the applicant has not
  // been contacted: a persistent banner says so on every visit, and the only
  // forward action is "Confirm applicant contact" (step 2). No
  // determination, query or due-date change may be offered from here.
  const isPendingContact = PENDING_CONTACT_STATE_IDS.has(workItem.stateId)
  const pendingContactCopy = PENDING_CONTACT_BANNERS[workItem.stateId]

  return {
    ...workItem,
    isPendingContact,
    // Only an approval has an accreditation ID to show (decision metadata is
    // never built for a refusal).
    pendingContactBanner: pendingContactCopy
      ? {
          ...pendingContactCopy,
          accreditationId: decisionMetadata?.accreditationId ?? null
        }
      : null,
    confirmContactHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/confirm-contact`,
    // Belt and braces: management-be projects no `sla-extend` here, but a
    // determination already made must never show a deadline control.
    canChangeDueDate: isPendingContact ? false : workItem.canChangeDueDate,
    canLogDecision,
    logDecisionHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/decision`,
    canDulyMake,
    dulyMakeHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/duly-make`,
    canChangePaymentDate,
    changePaymentDateHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/change-payment-date`,
    canContinueReview,
    // RA-000. The Query link — see `evaluateQueryEligibility`.
    canQuery: canQueryWorkItem(source, { route }),
    continueReviewHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/continue-review`,
    isReadOnlyState,
    stateTagClasses,
    decisionMetadata
  }
}
