import {
  getReAccreditationPriorYear,
  getWorkItem
} from '#/server/common/helpers/backend-api/backend-api.js'
import { notificationFailureDetected } from '#/server/work-items/core/audit-log.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { resolveDetailTemplate } from '#/server/work-items/core/templates.js'
import { createWorkItemActionsService } from '#/server/work-items/core/service.js'
import {
  findAssignableUser,
  getAssignableUsers
} from '#/server/work-items/core/assignees.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { isTaskComplete } from '#/server/work-items/core/task-status.js'
import {
  formatSiteAddress,
  getSitePostcode
} from '#/server/common/helpers/format/site-address.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { config } from '#/config/config.js'
import { unwrapMongoDate } from '#/server/common/helpers/format/mongo-date.js'
import { buildCaseHeader, buildCaseTabs } from './case-header.js'
import {
  buildApplicationSummary,
  buildBusinessPlanPairs,
  buildCaseFooterRows,
  tonnageBandLabel,
  EM_DASH
} from './application-summary.js'

const logger = createLogger()

const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

/**
 * Render a single work item.
 *
 * The backend's `WorkItemResponse` already carries the engine projection
 * (tasks + available actions) and the `templateVersion` the item was
 * assessed against, so we:
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

export function makeCompleteTaskController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const { id, taskId } = request.params
      const result = await service.completeTask({
        workItemId: id,
        taskId,
        user: getUser(request)
      })

      if (result.ok) {
        // PRG: redirect-after-post so refresh is harmless and the URL stays
        // clean of one-shot state.
        return h.redirect(successRedirect(request, id))
      }
      return renderDetailFromResult({
        request,
        h,
        id,
        result,
        actionLabel: `mark task "${taskId}" complete`
      })
    }
  }
}

/**
 * Move a task through the richer `WorkItemTaskStatus` lifecycle (epr-gl6).
 *
 * The form posts a single `status` field (e.g. `InProgress`); the service
 * validates it against the canonical set and forwards the change to the
 * backend's `PUT /tasks/{taskId}/status` endpoint. PRG-redirects on
 * success; engine rejections (unknown task, invalid value) and transport
 * failures surface inline via the same notification banner used by the
 * other action handlers.
 */
export function makeSetTaskStatusController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const { id, taskId } = request.params
      const payload = request.payload ?? {}
      const status = typeof payload.status === 'string' ? payload.status : ''
      const result = await service.setTaskStatus({
        workItemId: id,
        taskId,
        status,
        user: getUser(request)
      })

      if (result.ok) {
        return h.redirect(successRedirect(request, id))
      }
      return renderDetailFromResult({
        request,
        h,
        id,
        result,
        actionLabel: `update task "${taskId}" status`
      })
    }
  }
}

export function makeApplyActionController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const { id, actionId } = request.params
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

      const result = await service.assign({
        workItemId: id,
        assigneeId: user.id,
        assigneeName: user.name ?? null,
        user
      })

      if (result.ok) {
        return h.redirect(`/work-items/${encodeURIComponent(id)}`)
      }
      return renderDetailFromResult({
        request,
        h,
        id,
        result,
        actionLabel: 'self-assign work item'
      })
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
        pageTitle: 'Work item not found',
        heading: 'Work item not found',
        workItemId: id,
        breadcrumbs: [
          { text: 'Work items', href: '/work-items' },
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
  const enriched = applyReAccreditationViewModel({ workItem: decorated })
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
      heading: enriched.typeDisplayName,
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
  const authorisers = Array.isArray(priorYear.authorisers)
    ? priorYear.authorisers
    : []
  return {
    year: priorYear.year,
    tonnageBand: tonnageBandLabel(priorYear.tonnageBand),
    authoriserLines: authorisers.map((a) => a?.fullName || a?.email || EM_DASH),
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
 */
function buildAssignmentViewModel({ workItem, user }) {
  const isUnassigned = !workItem.assignedToId
  const callerIsAssignee = user?.id != null && workItem.assignedToId === user.id
  const canSelfAssign = user?.id != null && !callerIsAssignee

  return {
    assignedToId: workItem.assignedToId ?? null,
    assignedToName: workItem.assignedToName ?? workItem.assignedToId ?? null,
    assignedAt: workItem.assignedAt ?? null,
    assignedBy: workItem.assignedBy ?? null,
    isUnassigned,
    callerIsAssignee,
    canSelfAssign,
    canUnassign: !isUnassigned,
    assignableUsers: getAssignableUsers().map((u) => ({
      value: u.id,
      text: u.name ?? u.id,
      selected: u.id === workItem.assignedToId
    }))
  }
}

// RA-132. ----------------------------------------------------------------
// Re-accreditation-specific UI decoration.
//
// The generic decorator stays free of per-type rules. This helper layers
// in three things on top of an already-decorated work item, only when its
// `typeId` is `re-accreditation`:
//
//  - `canApproveDirectly` — whether the primary "Approve" CTA should
//    render. RA-323: any caseworker may approve, so this only mirrors the
//    backend's state eligibility check (`awaiting-decision`). The backend
//    remains authoritative; a forged POST is still rejected there.
//  - `approveHref` — link target for the CTA.
//  - `isReadOnlyState` + `stateTagClasses` — once the work item reaches
//    a terminal state (approved / rejected / withdrawn), the template
//    suppresses the generic action panel and shows a status tag.
//  - `decisionMetadata` — for approved work items, the issued
//    accreditation id + a GOV.UK formatted start date for display.
// -----------------------------------------------------------------------

const RE_ACCREDITATION_TYPE_ID = 're-accreditation'
const RE_ACCREDITATION_ELIGIBLE_STATE = 'awaiting-decision'
const RE_ACCREDITATION_TERMINAL_STATES = new Set([
  'approved',
  'rejected',
  'withdrawn'
])

function applyReAccreditationViewModel({ workItem }) {
  if (workItem.typeId !== RE_ACCREDITATION_TYPE_ID) {
    return workItem
  }

  const canApproveDirectly =
    workItem.stateId === RE_ACCREDITATION_ELIGIBLE_STATE

  const isReadOnlyState = RE_ACCREDITATION_TERMINAL_STATES.has(workItem.stateId)
  // RA-324 (AC08). Source the terminal "Outcome" tag colour from the shared
  // state-badge map so it matches the list and the envelope State badge.
  const stateTagClasses = stateTagClass(workItem.stateId)

  const decisionMetadata = buildDecisionMetadata(workItem)

  return {
    ...workItem,
    canApproveDirectly,
    approveHref: `/work-items/re-accreditation/${encodeURIComponent(workItem.id)}/approve`,
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

function decorate(workItem) {
  const type = getWorkItemType(workItem.typeId)
  const stateDisplayName =
    type?.states?.find((state) => state.id === workItem.stateId)?.displayName ??
    workItem.stateId
  return {
    ...workItem,
    typeDisplayName: type?.displayName ?? workItem.typeId,
    stateDisplayName,
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
    registrationId: workItem.payload?.operatorRegistrationId ?? null,
    assigneeDisplayName:
      workItem.assignedToName ?? workItem.assignedToId ?? null,
    // RA-245. Normalise the site address for display. The payload's
    // siteAddress arrives either as a nested { line1, line2, town, postcode }
    // object (form-created) or a flat string (legacy/seeded); compute the
    // display strings here so the template renders text, never "[object
    // Object]".
    siteAddressFormatted: formatSiteAddress(workItem.payload),
    sitePostcode: getSitePostcode(workItem.payload),
    tasks: Array.isArray(workItem.tasks)
      ? workItem.tasks.map(decorateTask)
      : [],
    taskProgress: computeTaskProgress(workItem.tasks)
  }
}

function computeTaskProgress(tasks) {
  const list = Array.isArray(tasks) ? tasks : []
  const total = list.length
  const completed = list.filter((task) => isTaskComplete(task)).length
  return { total, completed }
}

/**
 * Project a backend task into the richer view model the detail template
 * expects (epr-gl6). Falls back to the legacy `isComplete` boolean when an
 * older backend payload is rendered, so historical fixtures and any pre
 * epr-gl6 work item snapshots still display sensibly.
 */
function decorateTask(task) {
  const rawStatus = typeof task?.status === 'string' ? task.status : null
  const fallback = task?.isComplete ? 'Completed' : 'NotStarted'
  const canonical = TASK_STATUS_VIEW[rawStatus] ?? TASK_STATUS_VIEW[fallback]
  return {
    ...task,
    status: canonical.id,
    statusLabel: canonical.label,
    statusTagClass: canonical.tagClass,
    statusOptions: TASK_STATUS_OPTIONS.map((option) => ({
      ...option,
      selected: option.value === canonical.id
    }))
  }
}

const TASK_STATUS_VIEW = {
  NotStarted: {
    id: 'NotStarted',
    label: 'Not started',
    tagClass: 'govuk-tag--grey'
  },
  InProgress: {
    id: 'InProgress',
    label: 'In progress',
    tagClass: 'govuk-tag--blue'
  },
  Blocked: {
    id: 'Blocked',
    label: 'Blocked',
    tagClass: 'govuk-tag--red'
  },
  Completed: {
    id: 'Completed',
    label: 'Completed',
    tagClass: 'govuk-tag--green'
  }
}

const TASK_STATUS_OPTIONS = [
  { value: 'NotStarted', text: 'Not started' },
  { value: 'InProgress', text: 'In progress' },
  { value: 'Blocked', text: 'Blocked' },
  { value: 'Completed', text: 'Completed' }
]

/**
 * Resolve the success redirect target for a task-level POST. The tasks
 * page (RA-129) passes a hidden `returnTo` field on every form so the
 * status / quick-complete actions PRG-redirect back to the tasks page
 * the user submitted from. We only honour same-origin paths under
 * `/work-items/{id}` so a malicious form cannot use the field as an
 * open-redirect.
 */
function successRedirect(request, id) {
  const detail = `/work-items/${encodeURIComponent(id)}`
  const tasks = `${detail}/tasks`
  const payload = request.payload ?? {}
  const candidate = typeof payload.returnTo === 'string' ? payload.returnTo : ''
  if (candidate === tasks) return tasks
  return detail
}
