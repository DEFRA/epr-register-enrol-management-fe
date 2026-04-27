import {
  applyWorkItemAction,
  assignWorkItem,
  completeWorkItemTask,
  unassignWorkItem
} from '#/server/common/helpers/backend-api/backend-api.js'

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
  applyAction = applyWorkItemAction,
  assign = assignWorkItem,
  unassign = unassignWorkItem
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
      const result = await assign({ workItemId, assigneeId, assigneeName, user })
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
    }
  }
}

function assertId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
}

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
      message: result.problem?.detail ?? 'You are not authorised to perform this action'
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
  return { ok: false, reason: 'transport-error', message: result.error ?? 'Backend unreachable' }
}
