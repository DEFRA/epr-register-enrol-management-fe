/**
 * Pure helpers that mirror the backend task/state engine.
 *
 * The authoritative engine lives in `Backend.Api/WorkItems/Core/WorkItemService.cs`;
 * this module exists so frontend route handlers and module service objects can
 * inspect the work item the backend returned (or a freshly-built type
 * declaration) without re-implementing the rules. The backend already attaches
 * `tasks` and `availableActions` to each `WorkItemResponse`, so most callers
 * can read those directly. The helpers below are useful when the caller has
 * only the type declaration to hand (for example to ask "would this type allow
 * `approve` from this state if every task were complete?").
 */

import { isTaskComplete } from './task-status.js'

/**
 * Compute the task progress and currently-available actions for a work item.
 *
 * @param {object} type Work item type declaration (`module.type`).
 * @param {{ stateId: string, completedTaskIdsByState?: Record<string, string[]> }} workItem
 * @returns {{
 *   tasks: Array<{ id: string, displayName: string, isComplete: boolean }>,
 *   availableActions: Array<{ actionId: string, displayName: string, fromStateId: string, toStateId: string, requiresAllTasksComplete: boolean }>
 * }}
 */
export function projectWorkItem(type, workItem) {
  if (!type) {
    return { tasks: [], availableActions: [] }
  }
  const stateId = workItem?.stateId
  const completed = new Set(workItem?.completedTaskIdsByState?.[stateId] ?? [])

  const tasks = (type.getTasksForState?.(stateId) ?? []).map((task) => ({
    id: task.id,
    displayName: task.displayName,
    isComplete: completed.has(task.id)
  }))

  const currentState = type.states?.find((s) => s.id === stateId)
  if (currentState?.isTerminal) {
    return { tasks, availableActions: [] }
  }

  // Named distinctly from the exported `allTasksComplete` helper below —
  // an identically-named local would shadow it and make the two easy to
  // confuse when reading this function in isolation.
  const everyTaskComplete = tasks.every((t) => t.isComplete)
  const availableActions = (type.transitions ?? [])
    .filter((t) => t.fromStateId === stateId)
    .filter((t) => t.requiresAllTasksComplete === false || everyTaskComplete)
    .map((t) => ({
      actionId: t.actionId,
      displayName: t.displayName,
      fromStateId: t.fromStateId,
      toStateId: t.toStateId,
      requiresAllTasksComplete: t.requiresAllTasksComplete !== false
    }))

  return { tasks, availableActions }
}

/**
 * Are every one of this work item's current-state tasks complete?
 *
 * RA-346. Callers hand us one of two shapes, so resolve both from a single
 * place rather than letting each caller invent its own rule:
 *
 *  - A work item the BACKEND returned. It carries its own NON-EMPTY `tasks`
 *    array (each with a canonical `status`), which is authoritative — it
 *    reflects task state the type declaration cannot know about.
 *  - Anything else — no `tasks` key, or an EMPTY array — where the task list
 *    has to be derived from the type declaration.
 *
 * An empty `tasks` array is deliberately NOT treated as "nothing to do, so
 * everything is complete". `[].every(...)` is vacuously `true`, which would
 * fail OPEN and permit a gated action. It is also a reachable state, not a
 * hypothetical one: the backend's `WorkItemService.Project` returns an empty
 * task list when it cannot resolve the item's template snapshot. An empty
 * array therefore means "the backend told us nothing useful", so we fall
 * through to the declaration — which, for a state that genuinely declares
 * tasks, correctly reports them incomplete and fails CLOSED.
 *
 * A state that declares no tasks at all still resolves to `true`, which is
 * right: there is genuinely nothing to complete.
 *
 * `isTaskComplete` handles both the canonical `status` field and the legacy
 * `isComplete` boolean that `projectWorkItem` emits, so one predicate covers
 * both branches. It is the single owner of the legacy fallback — do not
 * re-pin that behaviour at other layers.
 *
 * @param {object} type Work item type declaration (`module.type`).
 * @param {object} workItem
 * @returns {boolean} `false` for a missing work item — we cannot prove an
 *   item we do not have is complete.
 */
export function allTasksComplete(type, workItem) {
  if (workItem == null) {
    return false
  }
  if (Array.isArray(workItem.tasks) && workItem.tasks.length > 0) {
    return workItem.tasks.every((task) => isTaskComplete(task))
  }
  return projectWorkItem(type, workItem).tasks.every((task) =>
    isTaskComplete(task)
  )
}

/**
 * Decide whether an action would be allowed for a work item right now.
 * Returns `{ allowed: true }` or `{ allowed: false, reason }` so callers can
 * surface the failure in a form.
 */
export function canApplyAction(type, workItem, actionId) {
  const transition = (type?.transitions ?? []).find(
    (t) => t.actionId === actionId
  )
  if (!transition) {
    return { allowed: false, reason: 'unknown-action' }
  }
  const stateId = workItem?.stateId
  if (!stateId) {
    return { allowed: false, reason: 'invalid-work-item' }
  }
  const currentState = type.states?.find((s) => s.id === stateId)
  if (currentState?.isTerminal) {
    return { allowed: false, reason: 'terminal-state' }
  }
  if (transition.fromStateId !== stateId) {
    return { allowed: false, reason: 'invalid-transition' }
  }
  if (
    transition.requiresAllTasksComplete !== false &&
    !allTasksComplete(type, workItem)
  ) {
    return { allowed: false, reason: 'incomplete-tasks' }
  }
  return { allowed: true }
}
