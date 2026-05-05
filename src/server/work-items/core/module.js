/**
 * Validate the shape of a work item module.
 *
 * Each module must export at minimum:
 *   - `type`:   the IWorkItemType-shaped object describing the work item type
 *   - `register(server)`: an async function that wires the module into Hapi
 *     (registers its routes, view paths, etc.). Treat it as a Hapi plugin's
 *     `register` callback that operates on the already-built `server`.
 *
 * The `type` block is declarative — it mirrors the backend `IWorkItemType`
 * contract so the frontend can answer "what tasks / actions are available?"
 * without round-tripping. The full state machine must be present at boot so
 * configuration mistakes fail loudly rather than silently mis-rendering a
 * detail page or letting the engine reject every action at runtime.
 *
 * Throws on the first invalid module.
 */
export function assertValidWorkItemModule(mod) {
  if (!mod || typeof mod !== 'object') {
    throw new Error('Work item module must be an object')
  }
  if (
    !mod.type ||
    typeof mod.type.id !== 'string' ||
    mod.type.id.trim() === ''
  ) {
    throw new Error(
      'Work item module must export a `type` with a non-empty string id'
    )
  }

  const type = mod.type
  const typeId = type.id

  if (typeof mod.register !== 'function') {
    throw new Error(
      `Work item module "${typeId}" must export an async \`register(server)\` function`
    )
  }

  if (
    typeof type.templateVersion !== 'string' ||
    type.templateVersion.trim() === ''
  ) {
    throw new Error(
      `Work item type "${typeId}" must declare a non-empty string \`templateVersion\``
    )
  }

  if (!Array.isArray(type.states) || type.states.length === 0) {
    throw new Error(
      `Work item type "${typeId}" must declare a non-empty \`states\` array`
    )
  }

  const stateIds = new Set()
  for (const state of type.states) {
    if (!state || typeof state.id !== 'string' || state.id.trim() === '') {
      throw new Error(
        `Work item type "${typeId}" has a state with a missing or non-string \`id\``
      )
    }
    if (stateIds.has(state.id)) {
      throw new Error(
        `Work item type "${typeId}" has duplicate state id "${state.id}"`
      )
    }
    stateIds.add(state.id)
  }

  const initialStateId =
    typeof type.initialState === 'string'
      ? type.initialState
      : type.initialState?.id
  if (typeof initialStateId !== 'string' || initialStateId.trim() === '') {
    throw new Error(
      `Work item type "${typeId}" must declare a non-empty \`initialState\``
    )
  }
  if (!stateIds.has(initialStateId)) {
    throw new Error(
      `Work item type "${typeId}" \`initialState\` "${initialStateId}" is not present in \`states\``
    )
  }

  if (!Array.isArray(type.transitions)) {
    throw new Error(
      `Work item type "${typeId}" must declare a \`transitions\` array`
    )
  }

  const actionIds = new Set()
  for (const transition of type.transitions) {
    if (!transition || typeof transition !== 'object') {
      throw new Error(
        `Work item type "${typeId}" has a transition that is not an object`
      )
    }
    if (
      typeof transition.actionId !== 'string' ||
      transition.actionId.trim() === ''
    ) {
      throw new Error(
        `Work item type "${typeId}" has a transition with a missing or non-string \`actionId\``
      )
    }
    if (
      typeof transition.fromStateId !== 'string' ||
      transition.fromStateId.trim() === ''
    ) {
      throw new Error(
        `Work item type "${typeId}" transition "${transition.actionId}" must declare a non-empty \`fromStateId\``
      )
    }
    if (
      typeof transition.toStateId !== 'string' ||
      transition.toStateId.trim() === ''
    ) {
      throw new Error(
        `Work item type "${typeId}" transition "${transition.actionId}" must declare a non-empty \`toStateId\``
      )
    }
    if (!stateIds.has(transition.fromStateId)) {
      throw new Error(
        `Work item type "${typeId}" transition "${transition.actionId}" references unknown \`fromStateId\` "${transition.fromStateId}"`
      )
    }
    if (!stateIds.has(transition.toStateId)) {
      throw new Error(
        `Work item type "${typeId}" transition "${transition.actionId}" references unknown \`toStateId\` "${transition.toStateId}"`
      )
    }
    if (actionIds.has(transition.actionId)) {
      throw new Error(
        `Work item type "${typeId}" has duplicate transition \`actionId\` "${transition.actionId}"`
      )
    }
    actionIds.add(transition.actionId)
  }

  if (typeof type.getTasksForState !== 'function') {
    throw new Error(
      `Work item type "${typeId}" must declare a \`getTasksForState\` function`
    )
  }
}
