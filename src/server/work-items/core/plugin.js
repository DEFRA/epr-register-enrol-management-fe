import { clearWorkItemRegistry, registerWorkItemType } from './registry.js'
import { assertValidWorkItemModule } from './module.js'

/**
 * Hapi plugin that registers a list of work item modules with the server.
 *
 * For each module:
 *   1. Its shape is validated up front.
 *   2. Its type is added to the in-memory work item registry.
 *   3. Its `register(server)` callback is awaited so it can mount routes,
 *      view paths and any module-scoped state.
 *
 * The work item and detail-template registries are cleared on every plugin
 * registration so repeated `createServer()` calls (as happens in tests)
 * don't accumulate stale types or templates.
 *
 * Adding a new work item type to the application requires only adding its
 * module to `src/server/work-items/modules.js` — no changes to this plugin
 * or to the rest of the core code.
 */
export const workItemsPlugin = (modules) => ({
  plugin: {
    name: 'work-items',
    async register(server) {
      clearWorkItemRegistry()
      for (const mod of modules) {
        assertValidWorkItemModule(mod)
        registerWorkItemType(mod.type)
        await mod.register(server)
      }
    }
  }
})
