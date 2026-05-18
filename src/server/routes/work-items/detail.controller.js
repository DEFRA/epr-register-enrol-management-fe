import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { resolveDetailTemplate } from '#/server/work-items/core/templates.js'
import { createWorkItemActionsService } from '#/server/work-items/core/service.js'
import {
  findAssignableUser,
  getAssignableUsers
} from '#/server/work-items/core/assignees.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import {
  ROLE_ASSIGN,
  ROLE_DECISION_MAKER
} from '#/server/common/helpers/auth/auth-scopes.js'
import { isTaskComplete } from '#/server/work-items/core/task-status.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'

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
 * Self-assign a work item: a standard-role user claims an unassigned
 * item for themselves. Distinct from `makeAssignController` so the route
 * can be gated declaratively at `requireStandard` rather than
 * `requireAssign` (RA-153). The handler derives the assignee from the
 * authenticated session, so the form carries no `assigneeId` /
 * `assigneeName` payload at all.
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

/**
 * Append a note (RA-96) to a work item. The form posts a single `text`
 * field; the controller forwards it through the framework service object
 * and PRG-redirects on success so refresh is harmless. Validation errors
 * (blank or over-length) come back as `reason: 'invalid'` and are surfaced
 * inline by the same notification banner used by the other action handlers.
 */
export function makeAddNoteController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const payload = request.payload ?? {}
      const text = typeof payload.text === 'string' ? payload.text : ''
      const result = await service.addNote({
        workItemId: id,
        text,
        user: getUser(request)
      })
      if (result.ok) {
        return h.redirect(`/work-items/${encodeURIComponent(id)}#notes`)
      }
      return renderDetailFromResult({
        request,
        h,
        id,
        result,
        actionLabel: 'add note'
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
          { text: 'Home', href: '/' },
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
          { text: 'Home', href: '/' },
          { text: 'Work items', href: '/work-items' },
          { text: id }
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
  const enriched = applyReAccreditationViewModel({
    workItem: decorated,
    request,
    user
  })
  const templatePath = resolveDetailTemplate(
    enriched.typeId,
    enriched.templateVersion
  )

  const assignment = buildAssignmentViewModel({
    workItem: enriched,
    request,
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

  return h
    .view(templatePath, {
      pageTitle: `Work item ${enriched.id}`,
      heading: enriched.typeDisplayName,
      breadcrumbs: [
        { text: 'Home', href: '/' },
        { text: 'Work items', href: '/work-items' },
        { text: enriched.id }
      ],
      workItem: enriched,
      assignment,
      notice,
      successBanner,
      flashBanner
    })
    .code(statusCode)
}

/**
 * Compute everything the detail template needs to render the assignment
 * panel:
 * - The current assignee (or null).
 * - Whether the caller can re-assign / unassign (the `assign` role).
 * - Whether the caller can self-assign right now (any signed-in user, but
 *   only when the item is currently unassigned).
 * - The list of users available in the picker for assign-role users.
 *
 * Keeping all of this in the controller means the template stays free of
 * permission logic.
 */
function buildAssignmentViewModel({ workItem, request, user }) {
  // Mirror the route-level scope check (`requireAssign`) so the UI only
  // surfaces affordances the caller can actually use. Reading from
  // `credentials.scope` matches what Hapi enforces on the assign /
  // unassign POST routes.
  const scope = request.auth?.credentials?.scope ?? []
  const canAssignAnyone = scope.includes(ROLE_ASSIGN)
  const isUnassigned = !workItem.assignedToId
  const callerIsAssignee = user?.id != null && workItem.assignedToId === user.id
  const canSelfAssign = !canAssignAnyone && isUnassigned && user?.id != null

  return {
    assignedToId: workItem.assignedToId ?? null,
    assignedToName: workItem.assignedToName ?? workItem.assignedToId ?? null,
    assignedAt: workItem.assignedAt ?? null,
    assignedBy: workItem.assignedBy ?? null,
    isUnassigned,
    callerIsAssignee,
    canAssignAnyone,
    canSelfAssign,
    canUnassign: canAssignAnyone && !isUnassigned,
    assignableUsers: canAssignAnyone
      ? getAssignableUsers().map((u) => ({
          value: u.id,
          text: u.name ?? u.id,
          selected: u.id === workItem.assignedToId
        }))
      : []
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
//    render. Mirrors the backend's eligibility checks: state must be
//    `assessment-in-progress` and the caller must either be the current
//    assignee or hold the decision-maker role. The backend remains
//    authoritative; a forged POST is still rejected there.
//  - `approveHref` — link target for the CTA.
//  - `isReadOnlyState` + `stateTagClasses` — once the work item reaches
//    a terminal state (approved / rejected / withdrawn), the template
//    suppresses the generic action panel and shows a status tag.
//  - `decisionMetadata` — for approved work items, the issued
//    accreditation id + a GOV.UK formatted start date for display.
// -----------------------------------------------------------------------

const RE_ACCREDITATION_TYPE_ID = 're-accreditation'
const RE_ACCREDITATION_ELIGIBLE_STATE = 'assessment-in-progress'
const RE_ACCREDITATION_TERMINAL_STATES = new Set([
  'approved',
  'rejected',
  'withdrawn'
])
const RE_ACCREDITATION_STATE_TAG_CLASSES = {
  approved: 'govuk-tag--green',
  rejected: 'govuk-tag--red',
  withdrawn: 'govuk-tag--grey'
}

function applyReAccreditationViewModel({ workItem, request, user }) {
  if (workItem.typeId !== RE_ACCREDITATION_TYPE_ID) {
    return workItem
  }

  const scope = request.auth?.credentials?.scope ?? []
  const hasDecisionMakerRole = scope.includes(ROLE_DECISION_MAKER)
  const callerIsAssignee = user?.id != null && workItem.assignedToId === user.id

  const canApproveDirectly =
    workItem.stateId === RE_ACCREDITATION_ELIGIBLE_STATE &&
    (callerIsAssignee || hasDecisionMakerRole)

  const isReadOnlyState = RE_ACCREDITATION_TERMINAL_STATES.has(workItem.stateId)
  const stateTagClasses =
    RE_ACCREDITATION_STATE_TAG_CLASSES[workItem.stateId] ?? ''

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
  const accreditationStartDate = payload.accreditationStartDate ?? null

  if (!accreditationId && !accreditationStartDate) {
    return null
  }

  let accreditationStartDateFormatted = '—'
  if (accreditationStartDate) {
    try {
      accreditationStartDateFormatted = formatDate(
        accreditationStartDate,
        'd MMMM yyyy'
      )
    } catch {
      // Backend produced a value we can't parse; fall back to the raw
      // ISO string so the user still sees something rather than a
      // template render error.
      accreditationStartDateFormatted = String(accreditationStartDate)
    }
  }

  return {
    accreditationId: accreditationId ?? '—',
    accreditationStartDate,
    accreditationStartDateFormatted
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
    payloadJson: safeStringify(workItem.payload),
    assigneeDisplayName:
      workItem.assignedToName ?? workItem.assignedToId ?? null,
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

function safeStringify(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return ''
  }
}

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
