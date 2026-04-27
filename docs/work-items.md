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
| `core/engine.js` | `projectWorkItem(type, workItem)` and `canApplyAction(type, workItem, actionId)` — pure helpers that mirror the backend task & state engine for use in handlers and templates. |
| `core/service.js` | `createWorkItemActionsService()` — framework-level service object that wraps the backend's task-completion and action endpoints with intent-named methods (`completeTask`, `applyAction`) and a result shape Hapi handlers can switch on. |
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
    },
    // Allowed state changes, exposed as named actions. The engine blocks
    // any action whose `requiresAllTasksComplete` is unset/`true` while
    // tasks for the from-state are outstanding. Set it to `false` for
    // actions that should always be available (e.g. "withdraw").
    transitions: [
      { actionId: 'approve', displayName: 'Approve', fromStateId: 'submitted', toStateId: 'approved' },
      { actionId: 'reject',  displayName: 'Reject',  fromStateId: 'submitted', toStateId: 'rejected' },
      { actionId: 'withdraw', displayName: 'Withdraw',
        fromStateId: 'submitted', toStateId: 'rejected', requiresAllTasksComplete: false }
    ]
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

## Cross-type list

The cross-type work item list lives outside any module — it shows every
submitted item regardless of type and is mounted at `/work-items` by
`src/server/routes/work-items/`. It calls `getWorkItems()` in
`src/server/common/helpers/backend-api/backend-api.js` and decorates each row
with the registered type's display name (falling back to the raw id if no
module is registered for that type).

The page supports filter, search and pagination (RA-93):

- Type filter — checkbox per registered module.
- State filter — checkbox per state surfaced by any registered module.
- Free-text search — matched on work item id and submitter.
- Pagination — `govuk-pagination`, default page size of 20.

All filters are submitted via plain GET (`<form method="get">` plus anchor
links for page navigation), so the page works with no JavaScript in the
browser. Unknown filter values are silently dropped at the controller so
bookmarked URLs from before a module was removed still render.

## Conventions

- A module **must not** import from another module's folder. Shared concerns
  belong in `src/server/work-items/core/` or in `src/server/common/`.
- Mount routes under `/work-items/<type-id>` to avoid clashes.
- Keep `type` declarative — no I/O from inside `getTasksForState` other than
  cheap pure logic. Side effects belong in route handlers / service objects.
- All form submissions go through service objects. Use
  `createWorkItemActionsService()` for task completion / state changes;
  module-specific services should follow the same factory + result-object
  pattern so handlers can switch on outcome without parsing HTTP.
- `clearWorkItemRegistry` is intended for tests and for the plugin itself,
  which calls it at the start of every registration so repeated `createServer()`
  calls in tests do not accumulate stale types.
