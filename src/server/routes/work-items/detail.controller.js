import {
  getReAccreditationPriorYear,
  getWorkItem
} from '#/server/common/helpers/backend-api/backend-api.js'
import { notificationFailureDetected } from '#/server/work-items/core/audit-log.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { buildWithdrawnNotice } from '#/server/work-items/core/withdrawn-notice.js'
import { resolveDetailTemplate } from '#/server/work-items/core/templates.js'
import { createWorkItemActionsService } from '#/server/work-items/core/service.js'
import { findAssignableUser } from '#/server/work-items/core/assignees.js'
import {
  evaluateLogDecisionEligibility,
  RE_ACCREDITATION_TYPE_ID
} from '#/server/work-items/re-accreditation/decision/eligibility.js'
import { evaluateDulyMakeEligibility } from '#/server/work-items/re-accreditation/duly-making/eligibility.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import {
  isCallerInvocable,
  resolveSelfAssignTransition
} from '#/server/work-items/core/engine.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { config } from '#/config/config.js'
import { unwrapMongoDate } from '#/server/common/helpers/format/mongo-date.js'
import { buildCaseHeader, buildCaseTabs } from './case-header.js'
import {
  authoriserName,
  buildApplicationSummary,
  buildBusinessPlanPairs,
  buildCaseFooterRows,
  tonnageBandLabel
} from './application-summary.js'

const logger = createLogger()

const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

/**
 * Render a single work item.
 *
 * The backend's `WorkItemResponse` already carries the engine projection
 * (available actions) and the `templateVersion` the item was assessed
 * against, so we:
 *   1. Fetch it via the backend client.
 *   2. Pick the detail template registered for `(typeId, templateVersion)`,
 *      falling back to the generic core template, so historical items keep
 *      their original look even after the live module ships a new template.
 *   3. Decorate with display-name lookups so templates don't have to know
 *      about the registry.
 *
 * The action handlers below render this view in-place with an inline
 * `notice` banner on engine failure rather than redirecting, so the user
 * sees the engine's reason attached to the up-to-date detail view.
 */
export const workItemDetailController = {
  async handler(request, h) {
    return renderDetail({ request, h })
  }
}

/**
 * Apply a named action. Forwards straight to the backend.
 *
 * ⚠ THIS HANDLER DELIBERATELY DOES NOT CHECK WHETHER THE ACTION IS ALLOWED,
 * and adding such a check here would be a real regression. Reading this in
 * isolation the omission looks like an oversight, so:
 *
 * The backend is authoritative for state changes (`docs/work-items.md`), and
 * it applies its own guard against the work item's frozen template snapshot.
 * That guard is the ONLY thing standing between a forged POST and a state
 * change — it protects every caller, not just this UI.
 *
 * The plausible wrong fix, which RA-410 makes tempting. `decorate` now hides
 * actions our own declaration marks `callerInvocable: false` (see
 * `nonInvocableActionIds`), so `reject` and `submit-for-decision` render
 * nowhere. Someone reasoning from that — or from an e2e spec asserting
 * `POST /actions/submit-for-decision` is refused — may conclude the frontend
 * is the tier that knows about invocability and add `canApplyAction` here.
 * It would make that spec pass while moving an authorisation decision into
 * the wrong tier: the route stays open to every non-browser caller, and the
 * real gate (the backend's) stops being the thing under test. If that spec
 * ever returns 200, the missing guard is management-be's.
 *
 * `core/engine.js#canApplyAction` says the same from the other side — it is
 * a mirror for inspecting a work item, never a control on this path.
 */
// RA-317. Withdraw is an OPERATOR action; Case Management must never show it
// or apply it, in any state. This helper backs both halves of that:
//   1. `decorate` strips `withdraw`/`withdraw-*` from `availableActions`, so
//      no withdraw affordance ever renders (and a withdraw-only state falls
//      through to the honest "No actions available" empty state).
//   2. `makeApplyActionController` rejects the same ids before the backend is
//      called, so a crafted POST that bypasses the UI cannot withdraw.
// Unlike every OTHER action id (which the apply-action route deliberately
// forwards to the backend as authoritative — see its docstring below), this
// is not moving an authorisation decision into the wrong tier: the whole
// ACTION CATEGORY is absent from CM, so refusing it here is the correct place.
// Kept as a local helper rather than importing the now-deleted
// withdraw.service.js, so the removed CM withdraw journey leaves no dead code.
const WITHDRAW_ACTION_PREFIX = 'withdraw'

function isWithdrawActionId(actionId) {
  return (
    typeof actionId === 'string' &&
    (actionId === WITHDRAW_ACTION_PREFIX ||
      actionId.startsWith(`${WITHDRAW_ACTION_PREFIX}-`))
  )
}

export function makeApplyActionController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const { id, actionId } = request.params

      // RA-317. Reject withdraw ids up front — the action is not available in
      // Case Management, so a crafted POST that bypasses the (now removed) UI
      // control gets the same "action not available" rendering the app gives
      // any unavailable action, and the backend is never asked to withdraw.
      if (isWithdrawActionId(actionId)) {
        return renderDetailFromResult({
          request,
          h,
          id,
          result: {
            ok: false,
            reason: 'not-allowed',
            message: 'This action is not available.'
          },
          actionLabel: actionId
        })
      }

      const result = await service.applyAction({
        workItemId: id,
        actionId,
        user: getUser(request)
      })

      if (result.ok) {
        return h.redirect(`/work-items/${encodeURIComponent(id)}`)
      }
      return renderDetailFromResult({
        request,
        h,
        id,
        result,
        actionLabel: actionId
      })
    }
  }
}

/**
 * Assign / re-assign / claim a work item.
 *
 * The form posts an `assigneeId` plus an optional `assigneeName` snapshot.
 * The frontend looks the id up in the assignable-users directory to provide
 * an authoritative name (so the snapshot is consistent with the directory
 * even if the form omits it). Authorization is enforced server-side by the
 * backend; this handler accepts the request from any authenticated user
 * and lets the backend reject anything the caller is not allowed to do.
 */
export function makeAssignController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const payload = request.payload ?? {}
      const rawAssigneeId =
        typeof payload.assigneeId === 'string' ? payload.assigneeId.trim() : ''

      if (rawAssigneeId === '') {
        return renderDetailFromResult({
          request,
          h,
          id,
          result: {
            ok: false,
            reason: 'invalid',
            message: 'Choose a user to assign this work item to.'
          },
          actionLabel: 'assign work item'
        })
      }

      const directoryEntry = findAssignableUser(rawAssigneeId)
      const assigneeName =
        directoryEntry?.name ??
        (typeof payload.assigneeName === 'string' &&
        payload.assigneeName.trim() !== ''
          ? payload.assigneeName.trim()
          : null)

      const result = await service.assign({
        workItemId: id,
        assigneeId: rawAssigneeId,
        assigneeName,
        user: getUser(request)
      })

      if (result.ok) {
        return h.redirect(`/work-items/${encodeURIComponent(id)}`)
      }
      return renderDetailFromResult({
        request,
        h,
        id,
        result,
        actionLabel: 'assign work item'
      })
    }
  }
}

/**
 * Self-assign a work item: a caseworker claims an unassigned item for
 * themselves in one click (RA-153), offered alongside the assign-to-anyone
 * picker. Distinct from `makeAssignController` since the handler derives
 * the assignee from the authenticated session, so the form carries no
 * `assigneeId` / `assigneeName` payload at all.
 *
 * RA-410. The button says "Assign to yourself and start", and now the
 * handler actually starts something: after a successful assignment it
 * applies whichever transition the work item's type marks
 * `startsOnSelfAssign` for the item's CURRENT state. For a re-accreditation
 * that is `payment-received`, moving `duly-made` into assessment. The
 * separate "Payment received" button is gone.
 *
 * ⚠ The state check is the load-bearing part. RA-295 renders the assignment
 * panel in EVERY state, so this handler is reached for `queried`,
 * `awaiting-decision` and the rest. `resolveSelfAssignTransition` returns
 * `null` for all of them and self-assign stays a plain assignment with no
 * state change. Do not hoist the transition out of that guard.
 *
 * Partial failure is deliberately NOT silent and deliberately NOT rolled
 * back. The two calls cannot be made atomic from here (management-be offers
 * no combined endpoint, by design — it reserved that for the decision hop,
 * where a half-finished write would lose a terminal decision). So:
 *
 *  - assign fails            -> nothing happened; render the error in place.
 *  - assign ok, transition fails -> the assignment STANDS, and the user is
 *    told exactly that. Rolling the assignment back would need a third call
 *    that can itself fail, and would throw away a correct, useful result.
 *    The item is left assigned to the caller and still not started, which is
 *    a state they can act on: `canSelfAssign` keeps the button rendering
 *    while a `startsOnSelfAssign` transition is still pending, and both
 *    halves are idempotent, so pressing it again retries just the missing
 *    half.
 */
export function makeSelfAssignController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      if (user?.id == null) {
        return renderDetailFromResult({
          request,
          h,
          id,
          result: {
            ok: false,
            reason: 'invalid',
            message: 'Could not identify the current user.'
          },
          actionLabel: 'self-assign work item'
        })
      }

      // Read the item BEFORE assigning: the transition to apply depends on
      // the state, and after a successful assign we would be reading a
      // response we did not ask for. A failure here is not fatal — the
      // assignment is still worth doing — so it degrades to "assign only"
      // rather than blocking, and the missing transition is recoverable via
      // the same button.
      const current = await getWorkItem({ workItemId: id, user })
      const startTransition = current?.ok
        ? resolveSelfAssignTransition(
            getWorkItemType(current.workItem?.typeId),
            current.workItem
          )
        : null

      if (!current?.ok) {
        logger.warn(
          { workItemId: id, status: current?.status },
          'Could not read work item before self-assign; assigning without starting'
        )
      }

      const result = await service.assign({
        workItemId: id,
        assigneeId: user.id,
        assigneeName: user.name ?? null,
        user
      })

      if (!result.ok) {
        return renderDetailFromResult({
          request,
          h,
          id,
          result,
          actionLabel: 'self-assign work item'
        })
      }

      if (startTransition == null) {
        return h.redirect(`/work-items/${encodeURIComponent(id)}`)
      }

      const transitionResult = await service.applyAction({
        workItemId: id,
        actionId: startTransition.actionId,
        user
      })

      if (!transitionResult.ok) {
        logger.warn(
          {
            workItemId: id,
            actionId: startTransition.actionId,
            reason: transitionResult.reason,
            status: transitionResult.status
          },
          'Self-assign succeeded but the start transition failed'
        )
        // Render in place rather than redirecting, so the banner sits on the
        // page showing the (now assigned, still not started) work item. The
        // message names BOTH halves — the user must not read this as "the
        // assignment failed" and go looking for it, nor as a generic error
        // that leaves them unsure what landed.
        return renderDetailFromResult({
          request,
          h,
          id,
          result: {
            ...transitionResult,
            message:
              'This application has been assigned to you, but it could not be started. Select "Assign to yourself and start" again to retry.'
          },
          actionLabel: 'start work item'
        })
      }

      return h.redirect(`/work-items/${encodeURIComponent(id)}`)
    }
  }
}

export function makeUnassignController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const result = await service.unassign({
        workItemId: id,
        user: getUser(request)
      })
      if (result.ok) {
        return h.redirect(`/work-items/${encodeURIComponent(id)}`)
      }
      return renderDetailFromResult({
        request,
        h,
        id,
        result,
        actionLabel: 'unassign work item'
      })
    }
  }
}

async function renderDetail({ request, h, notice = null, statusCode = 200 }) {
  const id = request.params.id
  const user = getUser(request)
  const result = await getWorkItem({ workItemId: id, user })

  if (result.ok === false && result.status === 404) {
    return h
      .view(NOT_FOUND_VIEW, {
        pageTitle: 'Application not found',
        heading: 'Application not found',
        workItemId: id,
        breadcrumbs: [
          { text: 'Applications', href: '/work-items' },
          { text: 'Not found' }
        ]
      })
      .code(404)
  }

  if (!result.ok) {
    return h
      .view(UNAVAILABLE_VIEW, {
        pageTitle: 'Work item unavailable',
        heading: 'Work item unavailable',
        workItemId: id,
        error: result.error ?? `Backend returned ${result.status}`,
        breadcrumbs: [
          { text: 'Work items', href: '/work-items' },
          { text: 'Work item' }
        ]
      })
      .code(502)
  }

  const decorated = decorate(result.workItem)
  // RA-132. Layer in re-accreditation-specific UI hints (Approve button
  // visibility, terminal-state read-only mode, issued-accreditation
  // metadata) without leaking type logic into the generic decorator. The
  // backend is still the source of truth for authorisation — this only
  // controls which affordances render.
  //
  // RA-346 / RA-410. `source` is the RAW backend DTO, deliberately not
  // `decorated`. Every eligibility gate must see exactly what the
  // corresponding ROUTE sees (each type-specific controller evaluates the
  // untouched `getWorkItem` result), or the button and the URL can disagree
  // — the item renders a CTA that the route then refuses. Eligibility is a
  // domain question; it must not be asked of view-model output. The tasks
  // normalisation that originally motivated this rule is gone, but the rule
  // is not: `decorate` still rewrites and drops fields, and
  // `duly-making/eligibility.js` reads `originStateId`, which only exists on
  // the raw DTO.
  const enriched = applyReAccreditationViewModel({
    workItem: decorated,
    source: result.workItem
  })
  const templatePath = resolveDetailTemplate(
    enriched.typeId,
    enriched.templateVersion
  )

  const assignment = buildAssignmentViewModel({
    workItem: enriched,
    user
  })

  // RA-127. Single-shot success banner. `request.yar.flash(name)` returns
  // an array of every value flashed under that key and clears it; we keep
  // the first entry (creation only flashes once per redirect) and ignore
  // anything else for forward-compat.
  const flashed = request.yar?.flash?.('successBanner') ?? []
  const successBanner =
    Array.isArray(flashed) && flashed.length > 0 ? flashed[0] : null

  // RA-132. Generic single-shot banner used by approve / decision-making
  // handlers. Same one-shot read-and-clear semantics as `successBanner`.
  const flashedBanners = request.yar?.flash?.('flashBanner') ?? []
  const flashBanner =
    Array.isArray(flashedBanners) && flashedBanners.length > 0
      ? flashedBanners[0]
      : null

  // RA-131. SLA management affordances — available to any caseworker.
  const slaMaxDays = config.get('workItems.sla.maxExtensionDays')

  // RA-211: surface an unresolved notification failure as a banner so
  // case workers know a lifecycle email (e.g. Queried) didn't reach the
  // operator, without having to open the audit log to find out.
  const notificationFailedBanner = notificationFailureDetected(
    enriched.auditLog
  )

  // RA-295 AC02. The former two-step application-details page is folded in
  // here, so the previous-year accreditation reference data it used to show
  // is fetched alongside the work item. Additive and failure-tolerant: a
  // failed lookup simply omits the section rather than failing the page.
  const priorYear = await loadPriorYear({ workItem: enriched, id, user })

  const { rows: applicationDetails } = buildApplicationSummary({
    workItem: enriched
  })

  return h
    .view(templatePath, {
      pageTitle: `Work item ${enriched.workItemLabel}`,
      // RA-295 AC01. The case header replaces both the page heading and the
      // GOV.UK breadcrumbs on this page — it carries its own "Applications"
      // back link — so no `breadcrumbs` are passed (the layout only renders
      // them when there is more than one).
      caseHeader: buildCaseHeader({ workItem: enriched, assignment }),
      caseTabs: buildCaseTabs({ workItemId: enriched.id, active: 'summary' }),
      applicationDetails,
      caseFooterRows: buildCaseFooterRows({ workItem: enriched }),
      priorYear,
      workItem: enriched,
      assignment,
      notice,
      successBanner,
      flashBanner,
      notificationFailedBanner,
      // RA-358. A withdrawn application still renders a normal 200 detail
      // page (management-be never deletes withdrawn items), so the page has
      // to say so itself. Built from the DECORATED item, whose
      // `applicationRef` is already the RA-249-safe "human ref or null".
      withdrawnNotice: buildWithdrawnNotice(enriched),
      slaMaxDays,
      reasonMaxLength: 500
    })
    .code(statusCode)
}

/**
 * Fetch and project the previous year's accreditation reference data for a
 * re-accreditation work item (RA-254, folded into the detail page by
 * RA-295). Returns null for any other type, and for a failed lookup — the
 * section is supplementary, so it must never break the page.
 */
async function loadPriorYear({ workItem, id, user }) {
  if (workItem.typeId !== RE_ACCREDITATION_TYPE_ID) {
    return null
  }
  const result = await getReAccreditationPriorYear({ workItemId: id, user })
  if (result?.ok !== true) {
    return null
  }
  const priorYear = result.priorYear
  // `ok: true` only means the call succeeded — a 200 carrying a null or
  // non-object body still satisfies it, and dereferencing that would throw
  // out of the handler and 500 the whole detail page. The section is
  // supplementary, so an unusable body is treated exactly like a failed
  // lookup: omit it, never break the page around it.
  if (priorYear == null || typeof priorYear !== 'object') {
    return null
  }
  const authorisers = Array.isArray(priorYear.authorisers)
    ? priorYear.authorisers
    : []
  return {
    year: priorYear.year,
    tonnageBand: tonnageBandLabel(priorYear.tonnageBand),
    authoriserLines: authorisers.map(authoriserName),
    businessPlanPairs: buildBusinessPlanPairs(priorYear.businessPlan)
  }
}

/**
 * Compute everything the detail template needs to render the assignment
 * panel:
 * - The current assignee (or null).
 * - The list of users available in the assign-to-anyone picker.
 * - Whether the caller can self-assign right now — RA-153's one-click
 *   shortcut, relabelled by RA-295 to the prototype's "Assign to yourself
 *   and start".
 *
 * RA-295 AC03: assignment must be available all the way through, so the
 * self-assign button is offered whenever the caller is not ALREADY the
 * assignee (claiming an unassigned item, or taking one over from a
 * colleague) rather than only while the item is unassigned. RA-323: every
 * caseworker has the same permissions, so the reassign / unassign links are
 * always available; the backend remains the source of truth and rejects
 * anything the caller may not do.
 *
 * RA-358 NARROWS BOTH OF THE ABOVE. "All the way through" now means through
 * the ACTIVE lifecycle: once a case reaches a terminal state (approved,
 * rejected, withdrawn) no assignment affordance renders at all.
 *
 * What was traded away, recorded deliberately so this does not read as an
 * oversight: RA-295 AC03's stated rationale was that a CLOSED case stays
 * reassignable SO IT CAN BE HANDED OVER, and there was a passing journey
 * test asserting exactly that (`ra-295-assignment-and-query.e2e.js`). Tom
 * overrode it as product authority after finding that "Assign to yourself
 * and start" on a withdrawn case worked — the label is nonsense on a closed
 * case, and before management-be's terminal-state guard the click really did
 * assign it. The hand-over use case was put to him explicitly and he chose
 * the gate; if it is ever reinstated, this is the flag to remove.
 *
 * This is a UI gate, not the enforcement point: management-be now rejects
 * assign/unassign on a terminal item with 409 TerminalState, so a forged
 * POST is still refused. The gate exists so the UI stops OFFERING an action
 * that can only fail — previously the page showed the withdrawn notice
 * ("no further action is needed") directly above three controls that
 * contradicted it.
 */
function buildAssignmentViewModel({ workItem, user }) {
  const callerIsAssignee = user?.id != null && workItem.assignedToId === user.id
  // Reuses the single TERMINAL_STATE_IDS list that also drives the
  // re-accreditation read-only Outcome panel, so the two cannot disagree.
  // Unlike that one this is NOT type-scoped: any registered type reaching
  // one of these states gets the gate, which is the desired behaviour.
  const isClosed = TERMINAL_STATE_IDS.has(workItem.stateId)

  return {
    assignedToId: workItem.assignedToId ?? null,
    assignedToName: workItem.assignedToName ?? workItem.assignedToId ?? null,
    assignedAt: workItem.assignedAt ?? null,
    assignedBy: workItem.assignedBy ?? null,
    callerIsAssignee,
    // RA-358. Drives the "This application is closed" line in place of the
    // affordances. Kept as its own flag rather than being folded into
    // `canSelfAssign` because the template needs to distinguish "no button
    // because you already hold it" from "no controls because it is closed".
    isClosed,
    // RA-410. The `|| selfAssignStartsWork` clause is the recovery path, not
    // a loosening. "Assign to yourself and start" is two operations, and if
    // the assign lands but the transition does not, `callerIsAssignee`
    // flips to true and the ONLY control that performs the transition would
    // disappear — leaving the caller holding an item they cannot start, with
    // the old "Payment received" button now filtered out of the actions
    // list. Keeping the button while the item still sits in a
    // `startsOnSelfAssign` state makes the retry reachable. Both halves are
    // idempotent (management-be: re-assigning the same user is a no-op that
    // writes no audit entry), so pressing it again is safe.
    canSelfAssign:
      user?.id != null &&
      !isClosed &&
      (!callerIsAssignee || workItem.selfAssignStartsWork === true)
    // RA-295 removed `isUnassigned`, `canUnassign` and `assignableUsers`
    // from this model: the reassign / unassign links are unconditional
    // WITHIN the active lifecycle (AC03, as narrowed by RA-358 above) and
    // the assignee picker moved to the reassign interstitial, which builds
    // its own list from the directory.
  }
}

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
//  - `isReadOnlyState` + `stateTagClasses` — once the work item reaches
//    a terminal state (approved / rejected / withdrawn), the template
//    suppresses the generic action panel and shows a status tag.
//  - `decisionMetadata` — for approved work items, the issued
//    accreditation id + a GOV.UK formatted start date for display.
// -----------------------------------------------------------------------

// The states in which a case is closed. Drives BOTH the re-accreditation
// read-only Outcome panel (`isReadOnlyState`) and, since RA-358, the
// assignment gate in `buildAssignmentViewModel` — deliberately ONE list, so
// the two cannot disagree about what "closed" means.
//
// Still a hardcoded literal rather than a registry lookup: every registered
// type's terminal states should ultimately derive from the module's declared
// `states[].isTerminal` flag, which is tracked separately as epr-uf42. Reuse
// this constant rather than adding another list.
//
// RA-346 note for anyone tempted to add a terminal-state check to the
// decision gate below: there is deliberately none. `canLogDecision` is
// answered by `evaluateLogDecisionEligibility`, which checks the type's own
// `isTerminal` flag before anything else, so a closed case fails it without
// consulting this list. The two rules are independent and both must hold.
const TERMINAL_STATE_IDS = new Set(['approved', 'rejected', 'withdrawn'])

/**
 * Is `stateId` the state the `continue-review-during-*` transitions leave
 * from? (RA-410.)
 *
 * Derived from the module declaration rather than comparing against a
 * `'updated'` literal, so that literal stays in `re-accreditation/module.js`
 * and a change to it moves this predicate — and therefore the CTA — with it.
 * All four `continue-review-during-*` entries share one `fromStateId`, which
 * is the whole reason they are non-caller-invocable, so any one of them
 * answers the question.
 *
 * Returns `false` when the type is not registered or declares no such
 * transition: failing CLOSED here hides a CTA rather than offering one the
 * route would refuse.
 */
function isContinueReviewState(stateId) {
  if (stateId == null) {
    return false
  }
  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  return (type?.transitions ?? []).some(
    (t) =>
      t.actionId?.startsWith(CONTINUE_REVIEW_ACTION_PREFIX) &&
      t.fromStateId === stateId
  )
}

const CONTINUE_REVIEW_ACTION_PREFIX = 'continue-review-during-'

function applyReAccreditationViewModel({ workItem, source = workItem }) {
  if (workItem.typeId !== RE_ACCREDITATION_TYPE_ID) {
    return workItem
  }

  // Gate on `source` (the raw backend DTO), never on `workItem` (the
  // decorated view model) — see the call site for why. The flag is then
  // merged into the view model below.
  const canLogDecision = evaluateLogDecisionEligibility(source).allowed

  // RA-316. Same discipline as the approve gate: evaluated against
  // `source` (the raw backend DTO), and through the SAME helper the
  // duly-making route guards itself with, so the CTA and the URL cannot
  // disagree. The `submitted` state rule lives in the module's `duly-make`
  // transition declaration, not here.
  const canDulyMake = evaluateDulyMakeEligibility(source).allowed

  // RA-372 / RA-410. Read off the module's own `continue-review-during-*`
  // declarations rather than testing for `'updated'` here, so that literal
  // stays in `re-accreditation/module.js`. All four share
  // `fromStateId: 'updated'`, so "is this item in the state those
  // transitions leave from" is exactly "should Continue review render".
  //
  // Replaces the old `isTaskWaypoint` derivation, which read `taskStateId`
  // — a field RA-410 removed. The CTA itself is unchanged.
  const canContinueReview = isContinueReviewState(source?.stateId)

  const isReadOnlyState = TERMINAL_STATE_IDS.has(workItem.stateId)
  // RA-324 (AC08). Source the terminal "Outcome" tag colour from the shared
  // state-badge map so it matches the list and the envelope State badge.
  const stateTagClasses = stateTagClass(workItem.stateId)

  const decisionMetadata = buildDecisionMetadata(workItem)

  return {
    ...workItem,
    canLogDecision,
    logDecisionHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/decision`,
    canDulyMake,
    dulyMakeHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/duly-make`,
    canContinueReview,
    continueReviewHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/continue-review`,
    isReadOnlyState,
    stateTagClasses,
    decisionMetadata
  }
}

function buildDecisionMetadata(workItem) {
  if (workItem.stateId !== 'approved') {
    return null
  }

  const payload = workItem.payload ?? {}
  const accreditationId = payload.accreditationId ?? null
  // RA-176: the backend stamps this as a plain ISO date string, but older
  // work items arrive as MongoDB extended JSON (`{ $date: '...' }`), which
  // would string-coerce to "[object Object]" in the panel if left unhandled.
  const accreditationStartDate = unwrapMongoDate(payload.accreditationStartDate)
  // RA-133: backend now stamps the accreditation year alongside the id
  // and start date so the UI can display the year independently of the
  // (locally-formatted) start date.
  const accreditationYear =
    typeof payload.accreditationYear === 'number'
      ? payload.accreditationYear
      : null

  if (
    !accreditationId &&
    !accreditationStartDate &&
    accreditationYear === null
  ) {
    return null
  }

  let accreditationStartDateFormatted = '—'
  if (accreditationStartDate) {
    try {
      accreditationStartDateFormatted = formatDate(
        accreditationStartDate,
        'd MMMM yyyy'
      )
    } catch (err) {
      // Backend produced a value we can't parse; fall back to the raw
      // ISO string so the user still sees something rather than a
      // template render error. Log it so ops can spot bad data.
      logger.warn(
        { err, accreditationStartDate, workItemId: workItem.id },
        'Re-accreditation accreditationStartDate could not be formatted'
      )
      accreditationStartDateFormatted = String(accreditationStartDate)
    }
  }

  return {
    accreditationId: accreditationId ?? '—',
    accreditationStartDate,
    accreditationStartDateFormatted,
    accreditationYear
  }
}

function renderDetailFromResult({ request, h, id, result, actionLabel }) {
  // Engine rejections (incomplete tasks, invalid transition, unknown action,
  // not authorised, not allowed assignment) and transport errors are
  // surfaced inline on a fresh detail render so the user sees the message
  // tied to the current state of the work item.
  request.params.id = id
  let statusCode
  if (result.reason === 'not-allowed') {
    statusCode = 409
  } else if (result.reason === 'not-authorized') {
    statusCode = 403
  } else {
    statusCode = 400
  }
  const notice = {
    kind: 'error',
    title: `Could not ${actionLabel}`,
    message: result.message ?? 'Action failed'
  }
  return renderDetail({ request, h, notice, statusCode })
}

// RA-131 / RA-295. The engine projects `sla-extend` as a normal action, but
// the UI renders it as "Change the due date" in the assignment panel rather
// than as a button in the actions list. It is therefore filtered OUT of
// `availableActions` here, and surfaced as its own `canChangeDueDate` flag.
//
// Filtering in the controller rather than skipping it in the template keeps
// `availableActions.length` honest: a work item whose ONLY action is
// sla-extend would otherwise render an "Actions" heading over an empty div
// and suppress the "No actions are currently available" message.
const SLA_EXTEND_ACTION_ID = 'sla-extend'

// RA-410. The same treatment for the transition "Assign to yourself and
// start" now applies (re-accreditation's `payment-received`). It used to
// render as its own "Payment received" button in the actions list, gated on
// a task; the task is gone and the button with it, because the assignment
// panel's primary button now performs it.
//
// Filtered here rather than skipped in the template for the reason spelled
// out above `SLA_EXTEND_ACTION_ID`: `availableActions.length` has to stay
// honest or a `duly-made` item could render an empty actions panel with no
// empty-state message.
//
// Read off the type DECLARATION, not off the projected action: the marker is
// a frontend-only convention (management-be has no such field), so the
// registry is the only place it exists.
function selfAssignActionIds(type) {
  return new Set(
    (type?.transitions ?? [])
      .filter((t) => t.startsOnSelfAssign === true)
      .map((t) => t.actionId)
  )
}

// RA-410. Actions the MODULE DECLARATION says the caller may not invoke.
//
// `isCallerInvocable` (core/engine.js) covers the same ground by reading the
// `callerInvocable` flag off the PROJECTED action, and its own docstring says
// the case it defends is a stale backend — a frontend deployed ahead of one.
// It cannot actually defend that case: a stale backend does not send the flag
// at all, and a missing flag means invocable (correctly, for forward-compat
// with older payloads). So the guard is silently absent in precisely the
// window it was written for.
//
// That window is live for this ticket. A backend that predates v12 still
// projects `submit-for-decision` and `reject` as caller-invocable, so between
// deploying this frontend and deploying that backend the actions panel would
// render a bare "Reject" button beside the Log decision CTA — and the generic
// `/actions/reject` route would accept it, letting a case worker refuse an
// application without ever seeing the decision page. Exactly the two-door
// decision the radio exists to collapse.
//
// Reading our own declaration closes it. Where the two disagree we HIDE:
// failing closed costs at worst an affordance the backend would have allowed,
// and the alternative costs a state change the UI was redesigned to prevent.
// The backend stays authoritative for whether an action SUCCEEDS — this only
// decides what to draw.
function nonInvocableActionIds(type) {
  return new Set(
    (type?.transitions ?? [])
      .filter((t) => t.callerInvocable === false)
      .map((t) => t.actionId)
  )
}

function decorate(workItem) {
  const type = getWorkItemType(workItem.typeId)
  const stateDisplayName =
    type?.states?.find((state) => state.id === workItem.stateId)?.displayName ??
    workItem.stateId
  // RA-364. Drop actions the backend flagged `callerInvocable: false` BEFORE
  // anything downstream reads the list — see `isCallerInvocable` for why the
  // backend projects actions the caller may not invoke.
  //
  // The filter belongs here rather than in the template loops for exactly the
  // reason the `sla-extend` filter above does: the template's
  // `availableActions.length > 0` check decides between the actions list and
  // the "No actions are currently available" message. Skipping entries inside
  // the `{% for %}` loops would leave an item whose actions are ALL
  // non-invocable rendering an empty panel with no empty-state message.
  //
  // Filtering at the source (rather than only on the rendered list) also
  // keeps `canChangeDueDate` below honest, and covers the type-specific
  // templates that override the `actionsPanel` block and re-loop over
  // `availableActions` themselves. `sla-extend` is caller-invocable, so the
  // due-date affordance is unaffected.
  const projectedActions = (
    Array.isArray(workItem.availableActions) ? workItem.availableActions : []
  ).filter(isCallerInvocable)
  const selfAssignActions = selfAssignActionIds(type)
  const declaredNonInvocable = nonInvocableActionIds(type)
  return {
    ...workItem,
    typeDisplayName: type?.displayName ?? workItem.typeId,
    stateDisplayName,
    // RA-317. Drop withdraw here too, at the SAME source the RA-364
    // non-invocable / sla-extend filtering runs, so it is gone BEFORE the
    // template's `availableActions.length > 0` check. Filtering withdraw only
    // in the template loops would reintroduce the exact RA-364 anti-pattern:
    // a state whose ONLY action was withdraw would render an empty
    // `work-item-actions` container instead of the "No actions" empty state.
    // Withdraw is an operator action, never a CM affordance in any state.
    availableActions: projectedActions.filter(
      (action) =>
        action?.actionId !== SLA_EXTEND_ACTION_ID &&
        !isWithdrawActionId(action?.actionId) &&
        !selfAssignActions.has(action?.actionId) &&
        !declaredNonInvocable.has(action?.actionId)
    ),
    // RA-410. True when self-assigning would ALSO move the item on — i.e.
    // the item is in the state a `startsOnSelfAssign` transition leaves
    // from. Read by `buildAssignmentViewModel` so the primary button keeps
    // rendering for a caller who already holds a not-yet-started item, which
    // is the recovery path when the assign half succeeded and the transition
    // half did not. Generic: the marker and the state both come from the
    // module declaration.
    selfAssignStartsWork: resolveSelfAssignTransition(type, workItem) != null,
    // RA-295. Gates BOTH due-date links in the assignment panel. The backend
    // is NOT a backstop here: SlaService.ExtendAsync validates the actor,
    // reason, duration bounds and the existence of the item and its clock,
    // but has no terminal-state check — so leaving these links ungated would
    // let a caseworker change the due date on an approved, rejected or
    // withdrawn case. AC03's "available throughout" is about ASSIGNMENT;
    // nothing asked for SLA controls on a closed case. Override is BFF-only
    // (never projected), so it rides on the same flag, exactly as it did
    // when both lived inside the actions list.
    canChangeDueDate: projectedActions.some(
      (action) => action?.actionId === SLA_EXTEND_ACTION_ID
    ),
    // RA-324 (AC08). The State badge colour is resolved from the shared
    // state-badge map so the detail page and the Applications list colour a
    // given status identically.
    stateTagClass: stateTagClass(workItem.stateId),
    // RA-249. A field LABELLED "Application ref" must only ever show the
    // human RA-* reference or nothing — never the work-item Guid. Do NOT
    // fall back to the id here.
    applicationRef: workItem.payload?.applicationReference ?? null,
    // RA-249. Separate navigational label for the page title, breadcrumb
    // leaf and caption ("Work item …"), where an identifier is legitimately
    // useful — so those may still fall back to the work-item id.
    workItemLabel:
      workItem.payload?.applicationReference ?? workItem.id ?? null,
    assigneeDisplayName:
      workItem.assignedToName ?? workItem.assignedToId ?? null
    // RA-295 removed `registrationId`, `siteAddressFormatted` and
    // `sitePostcode` from here. Their only consumers were the envelope
    // summary and the re-accreditation payload block, both of which are
    // gone; the operator registration id is now a reference-block row and
    // RA-245's address normalisation lives in `buildSiteAddressLines`.
    //
    // RA-410 removed `isTaskWaypoint`, `tasks` and `taskProgress`. The
    // waypoint FLAG is gone, but the waypoint CONCEPT is not: management-be
    // still reports the state a parked item will return to, renamed
    // `taskStateId` -> `originStateId`. It is read straight off the raw DTO
    // by `duly-making/eligibility.js`, which needs it undecorated, so it is
    // deliberately not re-exposed here. See `canContinueReview` below for
    // how the `updated` CTA survived losing the flag.
  }
}
