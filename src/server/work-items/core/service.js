import {
  addWorkItemNote,
  addWorkItemTaskNote,
  applyWorkItemAction,
  assignWorkItem,
  completeWorkItemTask,
  setWorkItemTaskStatus,
  unassignWorkItem
} from '#/server/common/helpers/backend-api/backend-api.js'

const TASK_STATUSES = ['NotStarted', 'InProgress', 'Blocked', 'Completed']

/**
 * Service object for the framework-level work item engine.
 *
 * Encapsulates the rules around how a Hapi handler talks to the backend's
 * task & state engine: which endpoint to hit, how to translate the HTTP
 * response into a result object that a controller or template can consume,
 * and what the contract is for module-specific service objects that wrap it.
 *
 * Module-specific service objects (for type-specific business logic) should
 * follow the same pattern: take their dependencies in a factory, expose
 * intent-named methods (`approveReaccreditation`, not `postEndpoint`), and
 * return `{ ok: true, workItem }` / `{ ok: false, reason, message }` shapes
 * so handlers can branch on outcome rather than parsing HTTP.
 *
 * Inject `dependencies` in tests to stub the backend client without mocking
 * `undici`.
 */
export function createWorkItemActionsService({
  completeTask = completeWorkItemTask,
  setTaskStatus = setWorkItemTaskStatus,
  applyAction = applyWorkItemAction,
  assign = assignWorkItem,
  unassign = unassignWorkItem,
  addNote = addWorkItemNote,
  addTaskNote = addWorkItemTaskNote
} = {}) {
  return {
    /**
     * Mark a single task complete on a work item.
     * @returns {Promise<{ ok: true, workItem: object } | { ok: false, reason: string, message: string, status?: number }>}
     */
    async completeTask({ workItemId, taskId, user = null }) {
      assertId(workItemId, 'workItemId')
      assertId(taskId, 'taskId')
      const result = await completeTask({ workItemId, taskId, user })
      return toResult(result)
    },

    /**
     * Set a task's lifecycle status (epr-gl6) on a work item. The status
     * is validated client-side against the canonical set so a bad form
     * submission is rejected before reaching the backend.
     */
    async setTaskStatus({ workItemId, taskId, status, user = null }) {
      assertId(workItemId, 'workItemId')
      assertId(taskId, 'taskId')
      const normalised = normaliseTaskStatus(status)
      if (normalised == null) {
        return {
          ok: false,
          reason: 'invalid',
          message: `Choose a valid status. Expected one of: ${TASK_STATUSES.join(', ')}.`
        }
      }
      const result = await setTaskStatus({
        workItemId,
        taskId,
        status: normalised,
        user
      })
      return toResult(result)
    },

    /**
     * Invoke a named action against a work item (e.g. approve, reject, withdraw).
     */
    async applyAction({ workItemId, actionId, user = null }) {
      assertId(workItemId, 'workItemId')
      assertId(actionId, 'actionId')
      const result = await applyAction({ workItemId, actionId, user })
      return toResult(result)
    },

    /**
     * Assign (or re-assign) a work item to a user. The backend enforces the
     * role-based rules; the BFF forwards the acting user's identity and
     * roles via headers attached by the backend client.
     */
    async assign({ workItemId, assigneeId, assigneeName = null, user = null }) {
      assertId(workItemId, 'workItemId')
      assertId(assigneeId, 'assigneeId')
      const result = await assign({
        workItemId,
        assigneeId,
        assigneeName,
        user
      })
      return toResult(result)
    },

    /**
     * Clear the current assignment. Backend requires the caller to hold the
     * `assign` role.
     */
    async unassign({ workItemId, user = null }) {
      assertId(workItemId, 'workItemId')
      const result = await unassign({ workItemId, user })
      return toResult(result)
    },

    /**
     * Append a free-text note (RA-96) to a work item. The backend snapshots
     * the acting user's identity onto the note for an immutable audit
     * narrative; the BFF just forwards the text and lets the backend
     * validate (blank text / over-length) so the rules live in one place.
     */
    async addNote({ workItemId, text, user = null }) {
      assertId(workItemId, 'workItemId')
      if (typeof text !== 'string' || text.trim() === '') {
        return {
          ok: false,
          reason: 'invalid',
          message: 'Note text is required.'
        }
      }
      const result = await addNote({ workItemId, text: text.trim(), user })
      return toResult(result)
    },

    /**
     * Append a free-text note scoped to a task (RA-129). Same contract as
     * {@link addNote} but routed to the task-scoped backend endpoint so the
     * note carries a `taskId` and the audit timeline records it as
     * `task-note-added`.
     */
    async addTaskNote({ workItemId, taskId, text, user = null }) {
      assertId(workItemId, 'workItemId')
      assertId(taskId, 'taskId')
      if (typeof text !== 'string' || text.trim() === '') {
        return {
          ok: false,
          reason: 'invalid',
          message: 'Note text is required.'
        }
      }
      const result = await addTaskNote({
        workItemId,
        taskId,
        text: text.trim(),
        user
      })
      return toResult(result)
    }
  }
}

function assertId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
}

function normaliseTaskStatus(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  // Strip hyphens / underscores / whitespace so wire-friendly variants
  // (`in-progress`, `not_started`) bind to the same canonical name as the
  // form's PascalCase value.
  const compact = trimmed.replace(/[\s_-]+/g, '').toLowerCase()
  const match = TASK_STATUSES.find(
    (canonical) => canonical.toLowerCase() === compact
  )
  return match ?? null
}

export { TASK_STATUSES }

function toResult(result) {
  if (result.ok) {
    return { ok: true, workItem: result.workItem }
  }
  if (result.status === 404) {
    return { ok: false, reason: 'not-found', message: 'Work item not found' }
  }
  if (result.status === 403) {
    return {
      ok: false,
      reason: 'not-authorized',
      status: result.status,
      message:
        result.problem?.detail ??
        'You are not authorised to perform this action'
    }
  }
  if (result.status === 409) {
    return {
      ok: false,
      reason: 'not-allowed',
      status: result.status,
      message: result.problem?.detail ?? 'Action not allowed'
    }
  }
  if (result.status === 400) {
    return {
      ok: false,
      reason: 'invalid',
      status: result.status,
      message: result.problem?.detail ?? 'Invalid action'
    }
  }
  if (result.status) {
    return {
      ok: false,
      reason: 'backend-error',
      status: result.status,
      message: result.problem?.detail ?? `Backend returned ${result.status}`
    }
  }
  return {
    ok: false,
    reason: 'transport-error',
    message: result.error ?? 'Backend unreachable'
  }
}
