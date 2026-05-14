import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { createWorkItemActionsService } from '#/server/work-items/core/service.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'

const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'
const TASKS_VIEW = 'work-items/tasks'

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
  Blocked: { id: 'Blocked', label: 'Blocked', tagClass: 'govuk-tag--red' },
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

const STATUS_GROUPS = ['NotStarted', 'InProgress', 'Blocked', 'Completed']

/**
 * Render the dedicated tasks & notes page (RA-129).
 *
 * Type-agnostic: groups tasks by lifecycle status, splits notes into
 * work-item-level (notes with no `taskId`) and per-task buckets and
 * renders the per-task add-note form, status-change form and quick-
 * complete form on each non-completed task. The summary page links here
 * for everything task- or note-related; this page links back to the
 * summary.
 */
export const workItemTasksController = {
  async handler(request, h) {
    return renderTasks({ request, h })
  }
}

/**
 * POST `/work-items/{id}/tasks/{taskId}/notes` — append a task-scoped
 * note. Validates non-blank text, calls the service, PRG-redirects on
 * success to the tasks-page anchor for the task. On validation /
 * backend failure re-renders the page in place with an error notice and
 * the typed text preserved against the offending task.
 */
export function makeAddTaskNoteController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const { id, taskId } = request.params
      const payload = request.payload ?? {}
      const text = typeof payload.text === 'string' ? payload.text : ''
      const result = await service.addTaskNote({
        workItemId: id,
        taskId,
        text,
        user: getUser(request)
      })
      if (result.ok) {
        return h.redirect(
          `/work-items/${encodeURIComponent(id)}/tasks#task-${encodeURIComponent(taskId)}`
        )
      }
      let statusCode
      if (result.reason === 'not-allowed') statusCode = 409
      else if (result.reason === 'not-authorized') statusCode = 403
      else statusCode = 400
      return renderTasks({
        request,
        h,
        statusCode,
        notice: {
          kind: 'error',
          title: `Could not add note to task "${taskId}"`,
          message: result.message ?? 'Action failed'
        },
        errorTaskId: taskId,
        errorTaskText: text
      })
    }
  }
}

async function renderTasks({
  request,
  h,
  notice = null,
  statusCode = 200,
  errorTaskId = null,
  errorTaskText = ''
}) {
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

  const workItem = result.workItem
  const type = getWorkItemType(workItem.typeId)
  const typeDisplayName = type?.displayName ?? workItem.typeId

  const allNotes = Array.isArray(workItem.notes) ? workItem.notes : []
  const workItemNotes = allNotes.filter((note) => note?.taskId == null)
  const notesByTask = new Map()
  for (const note of allNotes) {
    if (note?.taskId == null) continue
    const bucket = notesByTask.get(note.taskId) ?? []
    bucket.push(note)
    notesByTask.set(note.taskId, bucket)
  }

  const tasks = (Array.isArray(workItem.tasks) ? workItem.tasks : []).map(
    (task) => projectTask(task, notesByTask.get(task?.taskId) ?? [])
  )
  const groups = STATUS_GROUPS.map((statusId) => ({
    statusId,
    label: TASK_STATUS_VIEW[statusId].label,
    tagClass: TASK_STATUS_VIEW[statusId].tagClass,
    tasks: tasks.filter((task) => task.status === statusId)
  })).filter((group) => group.tasks.length > 0)

  return h
    .view(TASKS_VIEW, {
      pageTitle: `Tasks — work item ${workItem.id}`,
      heading: 'Tasks',
      breadcrumbs: [
        { text: 'Home', href: '/' },
        { text: 'Work items', href: '/work-items' },
        {
          text: workItem.id,
          href: `/work-items/${encodeURIComponent(workItem.id)}`
        },
        { text: 'Tasks' }
      ],
      workItem: {
        id: workItem.id,
        typeDisplayName,
        workItemNotes,
        groups,
        hasTasks: tasks.length > 0
      },
      notice,
      errorTaskId,
      errorTaskText
    })
    .code(statusCode)
}

function projectTask(task, notes) {
  const rawStatus = typeof task?.status === 'string' ? task.status : null
  const fallback = task?.isComplete ? 'Completed' : 'NotStarted'
  const canonical = TASK_STATUS_VIEW[rawStatus] ?? TASK_STATUS_VIEW[fallback]
  return {
    taskId: task?.taskId,
    displayName: task?.displayName,
    isComplete: canonical.id === 'Completed',
    status: canonical.id,
    statusLabel: canonical.label,
    statusTagClass: canonical.tagClass,
    statusOptions: TASK_STATUS_OPTIONS.map((option) => ({
      ...option,
      selected: option.value === canonical.id
    })),
    notes
  }
}
