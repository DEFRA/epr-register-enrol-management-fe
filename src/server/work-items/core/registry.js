/**
 * In-memory registry of work item types.
 *
 * The registry is kept here (rather than as a singleton attached to the server)
 * so it can be inspected from any layer of the application without needing the
 * Hapi `request` object. Tests should call {@link clearWorkItemRegistry} between
 * runs to keep state isolated.
 */

const types = new Map()

/**
 * Register a work item type. A type must have a unique, non-blank `id`.
 * @param {{ id: string, displayName: string, initialState: { id: string, displayName: string }, states: Array<{ id: string, displayName: string, isTerminal?: boolean }>, getTasksForState: (stateId: string) => Array<{ id: string, displayName: string }> }} type
 */
export function registerWorkItemType(type) {
  if (!type || typeof type.id !== 'string' || type.id.trim() === '') {
    throw new Error('Work item type must have a non-empty string id')
  }
  if (types.has(type.id)) {
    throw new Error(
      `A work item type with id "${type.id}" is already registered`
    )
  }
  types.set(type.id, type)
}

/** @returns {Array<object>} every registered type, in registration order. */
export function getWorkItemTypes() {
  return Array.from(types.values())
}

/** @param {string} id @returns {object|null} */
export function getWorkItemType(id) {
  return types.get(id) ?? null
}

/** Remove every registered type. Intended for tests. */
export function clearWorkItemRegistry() {
  types.clear()
}
