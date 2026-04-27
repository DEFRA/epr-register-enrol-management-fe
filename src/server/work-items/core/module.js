/**
 * Validate the shape of a work item module.
 *
 * Each module must export at minimum:
 *   - `type`:   the IWorkItemType-shaped object describing the work item type
 *   - `register(server)`: an async function that wires the module into Hapi
 *     (registers its routes, view paths, etc.). Treat it as a Hapi plugin's
 *     `register` callback that operates on the already-built `server`.
 *
 * Throws on the first invalid module so configuration mistakes fail loudly at
 * boot rather than silently mis-registering.
 */
export function assertValidWorkItemModule(mod) {
  if (!mod || typeof mod !== 'object') {
    throw new Error('Work item module must be an object')
  }
  if (!mod.type || typeof mod.type.id !== 'string' || mod.type.id.trim() === '') {
    throw new Error('Work item module must export a `type` with a non-empty string id')
  }
  if (typeof mod.register !== 'function') {
    throw new Error(
      `Work item module "${mod.type.id}" must export an async \`register(server)\` function`
    )
  }
}
