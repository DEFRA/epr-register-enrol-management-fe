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

  const allTasksComplete = tasks.every((t) => t.isComplete)
  const availableActions = (type.transitions ?? [])
    .filter((t) => t.fromStateId === stateId)
    .filter((t) => t.requiresAllTasksComplete === false || allTasksComplete)
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
  if (transition.requiresAllTasksComplete !== false) {
    const { tasks } = projectWorkItem(type, workItem)
    if (!tasks.every((t) => t.isComplete)) {
      return { allowed: false, reason: 'incomplete-tasks' }
    }
  }
  return { allowed: true }
}
