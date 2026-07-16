import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { isTaskComplete } from '#/server/work-items/core/task-status.js'

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
 * Render the dedicated tasks page (RA-129).
 *
 * Type-agnostic: groups tasks by lifecycle status and renders the
 * status-change form and quick-complete form on each non-completed task.
 * The summary page links here for everything task-related; this page
 * links back to the summary.
 */
export const workItemTasksController = {
  async handler(request, h) {
    return renderTasks({ request, h })
  }
}

async function renderTasks({ request, h, notice = null, statusCode = 200 }) {
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
          { text: 'Work item' }
        ]
      })
      .code(502)
  }

  const workItem = result.workItem
  const applicationRef = workItem.payload.applicationReference
  const type = getWorkItemType(workItem.typeId)
  const typeDisplayName = type?.displayName ?? workItem.typeId

  const tasks = (Array.isArray(workItem.tasks) ? workItem.tasks : []).map(
    (task) => projectTask(task)
  )
  const groups = STATUS_GROUPS.map((statusId) => ({
    statusId,
    label: TASK_STATUS_VIEW[statusId].label,
    tagClass: TASK_STATUS_VIEW[statusId].tagClass,
    tasks: tasks.filter((task) => task.status === statusId)
  })).filter((group) => group.tasks.length > 0)

  return h
    .view(TASKS_VIEW, {
      pageTitle: `Tasks — work item ${applicationRef}`,
      heading: 'Tasks',
      breadcrumbs: [
        { text: 'Home', href: '/' },
        { text: 'Work items', href: '/work-items' },
        {
          text: applicationRef,
          href: `/work-items/${encodeURIComponent(workItem.id)}`
        },
        { text: 'Tasks' }
      ],
      workItem: {
        id: workItem.id,
        applicationRef,
        typeDisplayName,
        groups,
        hasTasks: tasks.length > 0
      },
      notice
    })
    .code(statusCode)
}

function projectTask(task) {
  const rawStatus = typeof task?.status === 'string' ? task.status : null
  const fallback = isTaskComplete(task) ? 'Completed' : 'NotStarted'
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
    }))
  }
}
