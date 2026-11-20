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
    throw new TypeError(
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
    throw new TypeError(
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

  assertValidStandardLifecycle(type)

  // RA-410. A type no longer declares `getTasksForState`. The member was
  // removed from the contract along with the tasks feature, so requiring it
  // here would reject every module at boot.
}

const STANDARD_LIFECYCLE_BACKEND_STEPS = [
  'dulyMake',
  'recordDecision',
  'confirmContact'
]

const STANDARD_LIFECYCLE_BANNER_OUTCOMES = ['approved', 'rejected']

/**
 * RA-495. A type opting into the shared Standard-lifecycle pages
 * (`standardLifecycle`, see `standard-lifecycle/lifecycle.js`) must say where
 * its payment details live, and any backend call it declares must be one.
 * Checked at boot because a missing hook would otherwise render "Not
 * provided" on every Duly make page, and a bad call fail only on submit.
 */
function assertValidStandardLifecycle(type) {
  const lifecycle = type.standardLifecycle
  if (lifecycle == null) {
    return
  }
  if (typeof lifecycle.readPaymentDetails !== 'function') {
    throw new TypeError(
      `Work item type "${type.id}" \`standardLifecycle.readPaymentDetails\` must be a function`
    )
  }
  for (const step of STANDARD_LIFECYCLE_BACKEND_STEPS) {
    const call = lifecycle.backend?.[step]
    if (call !== undefined && typeof call !== 'function') {
      throw new TypeError(
        `Work item type "${type.id}" \`standardLifecycle.backend.${step}\` must be a function`
      )
    }
  }
  for (const outcome of STANDARD_LIFECYCLE_BANNER_OUTCOMES) {
    const banner = lifecycle.contactConfirmedBanners?.[outcome]
    if (
      banner !== undefined &&
      (typeof banner?.title !== 'string' || typeof banner?.text !== 'string')
    ) {
      throw new TypeError(
        `Work item type "${type.id}" \`standardLifecycle.contactConfirmedBanners.${outcome}\` must have a string title and text`
      )
    }
  }
}
