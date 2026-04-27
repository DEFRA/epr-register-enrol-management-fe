# Work item framework (frontend)

The frontend mirrors the backend's work item framework so that adding a new
work item type means creating one module — no changes to core code beyond
listing the module in `src/server/work-items/modules.js`.

## Building blocks

Defined in `src/server/work-items/`:

| File | Purpose |
| --- | --- |
| `core/registry.js` | In-memory registry of work item types: `registerWorkItemType`, `getWorkItemType`, `getWorkItemTypes`, `clearWorkItemRegistry`. |
| `core/module.js` | `assertValidWorkItemModule(mod)` — boot-time validation of a module's shape. |
| `core/plugin.js` | `workItemsPlugin(modules)` — Hapi plugin that registers each module with the server. |
| `modules.js` | The list of modules wired into the application. **The only file that changes when adding a type.** |

The plugin is mounted in `src/server/plugins/router.js` and runs once during
`createServer()`.

## Module contract

A work item module is a plain object exporting:

```js
export const myTypeModule = {
  type: {
    id: 'my-type',                                  // unique stable id
    displayName: 'My type',
    initialState: { id: 'submitted', displayName: 'Submitted' },
    states: [
      { id: 'submitted', displayName: 'Submitted' },
      { id: 'approved',  displayName: 'Approved', isTerminal: true },
      { id: 'rejected',  displayName: 'Rejected', isTerminal: true }
    ],
    // Tasks required while the work item is in <stateId>. Return [] for
    // states with nothing to do. May be computed from data.
    getTasksForState(stateId) {
      switch (stateId) {
        case 'submitted':
          return [
            { id: 'check-eligibility', displayName: 'Check eligibility' },
            { id: 'verify-documents', displayName: 'Verify documents' }
          ]
        default:
          return []
      }
    }
  },

  // Hapi plugin-style register; receives the already-built server.
  // Mount routes under /work-items/<type-id>/... to stay isolated.
  async register(server) {
    server.route({
      method: 'GET',
      path: '/work-items/my-type',
      handler: () => ({ ok: true })
    })
  }
}
```

## Adding a new work item type

1. Create `src/server/work-items/<type-id>/module.js` exporting the contract
   above. Co-locate templates, controllers and helpers under the same folder:

   ```
   src/server/work-items/my-type/
     module.js
     controllers/
     templates/
     helpers/
   ```

2. Add it to `src/server/work-items/modules.js`:

   ```js
   import { myTypeModule } from './my-type/module.js'
   export const workItemModules = [myTypeModule]
   ```

That is the complete list of changes required outside the new module folder.

## Conventions

- A module **must not** import from another module's folder. Shared concerns
  belong in `src/server/work-items/core/` or in `src/server/common/`.
- Mount routes under `/work-items/<type-id>` to avoid clashes.
- Keep `type` declarative — no I/O from inside `getTasksForState` other than
  cheap pure logic. Side effects belong in route handlers / service objects.
- `clearWorkItemRegistry` is intended for tests and for the plugin itself,
  which calls it at the start of every registration so repeated `createServer()`
  calls in tests do not accumulate stale types.
