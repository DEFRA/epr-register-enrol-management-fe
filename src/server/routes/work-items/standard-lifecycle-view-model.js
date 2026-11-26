import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { evaluateChangeValidFromEligibility } from '#/server/work-items/core/standard-lifecycle/change-valid-from/eligibility.js'
import { evaluateLogDecisionEligibility } from '#/server/work-items/core/standard-lifecycle/decision/eligibility.js'
import { evaluateDulyMakeEligibility } from '#/server/work-items/core/standard-lifecycle/duly-making/eligibility.js'
import {
  CHANGE_VALID_FROM_PAGE,
  CONFIRM_CONTACT_PAGE,
  DECISION_PAGE,
  DULY_MAKE_PAGE,
  lifecyclePageHref,
  usesStandardLifecycle
} from '#/server/work-items/core/standard-lifecycle/lifecycle.js'
import {
  PENDING_CONTACT_STATE_IDS,
  STATE_APPROVED_PENDING_CONTACT,
  STATE_REJECTED_PENDING_CONTACT
} from '#/server/work-items/core/standard-lifecycle/states.js'
import { TERMINAL_STATE_IDS } from './assignment-view-model.js'

// RA-495. ----------------------------------------------------------------
// Standard-lifecycle UI decoration, shared by every type on the Standard
// lifecycle (it was re-accreditation's, RA-132 onwards):
//
//  - `canDulyMake` + `dulyMakeHref` (RA-316) and `canLogDecision` +
//    `logDecisionHref` (RA-410) — whether the "Duly make" / "Make
//    Determination" CTAs render, and where they go. Each is answered by the
//    same eligibility helper that guards the page's own route, against the
//    RAW backend DTO (`source`), so the button and the URL cannot disagree.
//  - `isPendingContact`, `pendingContactBanner` and `confirmContactHref`
//    (RA-527) — step 1 of the determination is done but the applicant has
//    not been contacted: a persistent banner says so, and "Confirm applicant
//    contact" is the only forward action. No due-date change is offered.
//  - `isReadOnlyState` + `stateTagClasses` — once the work item is closed
//    the template shows the Outcome panel, coloured from the shared state
//    badge map, instead of any action.
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

/**
 * The Standard-lifecycle view-model fields for a work item of `typeId`,
 * without asking whether the type has opted in (re-accreditation's view
 * model always applies them).
 *
 * @param {object} args
 * @param {object} args.workItem the decorated view model
 * @param {object} [args.source] the RAW backend DTO the gates read
 * @param {string|null} [args.accreditationId] shown in the approval's
 *   pending-contact banner (re-accreditation mints one at step 1)
 * @returns {object} the fields to merge into the view model
 */
export function buildStandardLifecycleFields({
  workItem,
  source = workItem,
  accreditationId = null
}) {
  const typeId = workItem.typeId
  const scope = { typeId }
  const isPendingContact = PENDING_CONTACT_STATE_IDS.has(workItem.stateId)
  const pendingContactCopy = PENDING_CONTACT_BANNERS[workItem.stateId]

  return {
    isPendingContact,
    // Only an approval has an accreditation ID to show.
    pendingContactBanner: pendingContactCopy
      ? { ...pendingContactCopy, accreditationId }
      : null,
    confirmContactHref: lifecyclePageHref(
      typeId,
      workItem.id,
      CONFIRM_CONTACT_PAGE
    ),
    // Belt and braces: management-be projects no `sla-extend` here, but a
    // determination already made must never show a deadline control.
    canChangeDueDate: isPendingContact ? false : workItem.canChangeDueDate,
    canLogDecision: evaluateLogDecisionEligibility(source, scope).allowed,
    logDecisionHref: lifecyclePageHref(typeId, workItem.id, DECISION_PAGE),
    // RA-800. The "Change valid from date" link, through the same gate that
    // guards the page's own route.
    canChangeValidFrom: evaluateChangeValidFromEligibility(source, scope)
      .allowed,
    changeValidFromHref: lifecyclePageHref(
      typeId,
      workItem.id,
      CHANGE_VALID_FROM_PAGE
    ),
    canDulyMake: evaluateDulyMakeEligibility(source, scope).allowed,
    dulyMakeHref: lifecyclePageHref(typeId, workItem.id, DULY_MAKE_PAGE),
    isReadOnlyState: TERMINAL_STATE_IDS.has(workItem.stateId),
    // RA-324 (AC08). The terminal "Outcome" tag colour comes from the shared
    // state-badge map so it matches the list and the case header.
    stateTagClasses: stateTagClass(workItem.stateId)
  }
}

/**
 * Layer the Standard-lifecycle fields onto a work item whose type has opted
 * into the Standard lifecycle. Any other work item is returned unchanged.
 *
 * @param {object} args
 * @param {object} args.workItem the decorated view model
 * @param {object} [args.source] the RAW backend DTO the gates read
 * @returns {object}
 */
export function applyStandardLifecycleViewModel({
  workItem,
  source = workItem
}) {
  if (!usesStandardLifecycle(workItem)) {
    return workItem
  }
  return { ...workItem, ...buildStandardLifecycleFields({ workItem, source }) }
}
