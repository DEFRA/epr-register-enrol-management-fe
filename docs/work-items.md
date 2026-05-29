# Work item framework (frontend)

The frontend mirrors the backend's work item framework so that adding a new
work item type means creating one module — no changes to core code beyond
listing the module in `src/server/work-items/modules.js`.

## Building blocks

Defined in `src/server/work-items/`:

| File               | Purpose                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/registry.js` | In-memory registry of work item types: `registerWorkItemType`, `getWorkItemType`, `getWorkItemTypes`, `clearWorkItemRegistry`.                                                                                                            |
| `core/module.js`   | `assertValidWorkItemModule(mod)` — boot-time validation of a module's shape.                                                                                                                                                              |
| `core/plugin.js`   | `workItemsPlugin(modules)` — Hapi plugin that registers each module with the server.                                                                                                                                                      |
| `core/engine.js`   | `projectWorkItem(type, workItem)` and `canApplyAction(type, workItem, actionId)` — pure helpers that mirror the backend task & state engine for use in handlers and templates.                                                            |
| `core/service.js`  | `createWorkItemActionsService()` — framework-level service object that wraps the backend's task-completion and action endpoints with intent-named methods (`completeTask`, `applyAction`) and a result shape Hapi handlers can switch on. |
| `modules.js`       | The list of modules wired into the application. **The only file that changes when adding a type.**                                                                                                                                        |

The plugin is mounted in `src/server/plugins/router.js` and runs once during
`createServer()`.

## Module contract

A work item module is a plain object exporting:

```js
export const myTypeModule = {
  type: {
    id: 'my-type', // unique stable id
    displayName: 'My type',
    initialState: { id: 'submitted', displayName: 'Submitted' },
    states: [
      { id: 'submitted', displayName: 'Submitted' },
      { id: 'approved', displayName: 'Approved', isTerminal: true },
      { id: 'rejected', displayName: 'Rejected', isTerminal: true }
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
      {
        actionId: 'approve',
        displayName: 'Approve',
        fromStateId: 'submitted',
        toStateId: 'approved'
      },
      {
        actionId: 'reject',
        displayName: 'Reject',
        fromStateId: 'submitted',
        toStateId: 'rejected'
      },
      {
        actionId: 'withdraw',
        displayName: 'Withdraw',
        fromStateId: 'submitted',
        toStateId: 'rejected',
        requiresAllTasksComplete: false
      }
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

## Detail view (RA-94)

The detail view at `/work-items/{id}` is a generic page mounted by
`src/server/routes/work-items/` that renders **any** work item, regardless
of type, by reading the projection returned by the backend. The same
controller handles three operations:

| Method | Route                                      | Purpose                                                                                                                             |
| ------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/work-items/{id}`                         | Render the detail view: envelope summary, current task list and available actions.                                                  |
| `POST` | `/work-items/{id}/tasks/{taskId}/complete` | Mark a task complete, then PRG-redirect back to the detail view. On engine failure, re-renders in place with a notification banner. |
| `POST` | `/work-items/{id}/actions/{actionId}`      | Apply a named action (e.g. `approve`, `reject`), then PRG-redirect. Same in-place error rendering.                                  |

POST handlers go through `createWorkItemActionsService()`, which wraps the
backend HTTP calls and returns a typed result the controller switches on
(`{ ok: true, workItem }`, `{ ok: false, reason: 'not-allowed', status,
message }`, `{ ok: false, reason: 'invalid', status, message }`, etc.).
The generic detail template lives at
`src/server/routes/work-items/detail.njk` and uses **only** GOV.UK Design
System macros — no JavaScript — so the page works in the same way the rest
of the service does.

### Type-specific detail templates

A module can declare a type-specific Nunjucks template by setting
`detailTemplate` on its `type` object. The controller reads
`getWorkItemType(typeId)?.detailTemplate` and falls back to the generic
`'work-items/detail'` when the property is absent. Template paths are
relative to `src/server/routes/`, matching the Nunjucks `relativeTo` config.

```js
export const myTypeModule = {
  type: {
    id: 'my-type',
    detailTemplate: 'my-type/detail' // optional; omit to use the generic template
    // ...
  },
  async register(server) {
    /* ... */
  }
}
```

The plugin calls `clearWorkItemRegistry()` at the start of every registration
so repeated `createServer()` calls in tests don’t accumulate stale types.

## Assignment (RA-95)

The list and detail pages support assignment of work items to a user.
Two roles drive what a user can do:

- `assign` — sees an assignee picker on the detail page and can re-assign
  or unassign any work item.
- `standard` — sees a single "Take this work item" button on the detail
  page when the item is unassigned. Cannot re-assign other people's work.

The frontend is a BFF: every request to the backend forwards the signed-in
user's id, name and roles via these headers (set by
`buildHeaders` in `backend-api.js`):

| Header             | Value                                            |
| ------------------ | ------------------------------------------------ |
| `x-cdp-user-id`    | `request.auth.credentials.id`                    |
| `x-cdp-user-name`  | `request.auth.credentials.name`                  |
| `x-cdp-user-roles` | `request.auth.credentials.roles` joined with `,` |

The backend turns those into claims and enforces the role rules
server-side; the BFF UI affordances are a UX convenience only.

### Assignable users directory

`src/server/work-items/core/assignees.js` exposes `getAssignableUsers()`
and `findAssignableUser(id)`. For the PoC this re-uses the stub-auth
`STUB_USERS` list so the picker, the form values and the user that signs
in via the stub login all share the same ids. A real deployment will
replace this with an Entra ID directory lookup.

The directory is gated on `auth.stubEnabled`: when stub auth is disabled
(any environment using real OAuth) `getAssignableUsers()` returns an
empty array and `findAssignableUser()` returns `null` for every id, so
the PoC stub identities cannot leak into a production environment via
the assign UI. Returned arrays are fresh per call and the per-user
entries are frozen, so callers can sort/filter the result without
affecting other callers and accidental property writes throw in strict
mode.

### List filters

The list page exposes an "Assignment" filter with four mutually-exclusive
modes (radio buttons), encoded into `assigneeMode`:

| Mode            | Backend translation                                 |
| --------------- | --------------------------------------------------- |
| `any` (default) | no filter                                           |
| `mine`          | `assigneeId=<currentUserId>`                        |
| `unassigned`    | `unassigned=true`                                   |
| `user`          | `assigneeId=<assigneeUserId>` (revealed `<select>`) |

### Detail actions

| Route                            | Authorization (Hapi scope is intentionally **not** set)                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /work-items/{id}/assign`   | Open to any authenticated user; backend rejects with 403 if the caller is a standard user trying to assign to someone else or take an owned item. |
| `POST /work-items/{id}/unassign` | Open at the route layer; backend requires the `assign` role.                                                                                      |

The assign controller resolves the snapshot display name from the
assignable-users directory so the backend always receives a canonical
`assigneeName` even when the form omitted it.

## Notes (RA-96)

The detail page renders the framework-level **notes** an assessor has
attached to the work item, plus a single-textarea form for adding a new
one. Notes are an append-only audit narrative — there is no edit or
delete UI by design.

### Wiring

| Layer                                                              | What it does                                                                                                                                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend-api.js` `addWorkItemNote({ workItemId, text, user })`     | POSTs `{ text }` to `/work-items/{id}/notes` with the user-\* headers.                                                                                                             |
| `core/service.js` `service.addNote({ workItemId, text, user })`    | Validates locally for blank text (so we don't round-trip an obviously-bad request), trims, calls the API client, returns the framework's standard `{ ok, reason, message }` shape. |
| `routes/work-items/detail.controller.js` `makeAddNoteController()` | Wired at `POST /work-items/{id}/notes`. PRG-redirects to `/work-items/{id}#notes` on success; re-renders the detail page with an inline notification banner on validation failure. |
| `routes/work-items/detail.njk`                                     | Renders existing notes (newest-first as the backend projects them) plus a `govukCharacterCount` form (`maxlength: 4000` mirrors `WorkItemService.MaxNoteLength`).                  |

### Conventions

- The detail template is intentionally permissive — every authenticated
  user sees the add-note form. Authorization is the backend's job.
- Note text is rendered with `white-space: pre-wrap` so line breaks the
  assessor entered are preserved without enabling HTML.
- Author display falls back through `createdByName → createdBy → "Unknown"`
  so a note remains attributable even if the user-name header was missing
  at write time.

## Audit log (RA-97)

A framework-provided **audit log** records every state-changing action
that has occurred against a work item: task completions, action
applications, assignment changes, notes added. The log lives on its own
page at `/work-items/{id}/audit-log` so the detail view stays focused on
the work item's current state, tasks and actions; the detail page links
out to it. Modules inherit the timeline for free — they do not register
anything to opt in.

### Wiring

| Layer                                                                    | What it does                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend-api.js` `getWorkItem`                                           | The backend already includes `auditLog` (oldest-first) on the `WorkItemResponse`; nothing new to call.                                                                          |
| `core/audit-log.js` `decorateAuditLog(entries)`                          | Adds a one-line `summary` per entry derived from its `details` (e.g. task display name, `from → to` state, assignee name change). Pure helper.                                  |
| `routes/work-items/audit-log.controller.js` `workItemAuditLogController` | Re-fetches the work item, decorates the entries with `decorateAuditLog`, and renders the standalone audit log template.                                                         |
| `routes/work-items/audit-log.njk`                                        | Renders entries as an ordered list under the **Audit log** heading, in the order the backend projected them (chronological, oldest-first), with a link back to the detail page. |
| `routes/work-items/detail.njk`                                           | Renders a **View audit log** link to `/work-items/{id}/audit-log` instead of the timeline itself.                                                                               |

### Conventions

- The backend is the source of truth for ordering — the frontend never
  re-sorts. If a project ever wants newest-first, change the backend
  projection (and the docs above).
- Author display falls back through `createdByName → createdBy → "System"`.
- The summary is **derived**, not authored: if a new action or a new
  detail key is added on the backend, extend `summariseAuditEntry` so the
  template stays declarative.

## Example: re-accreditation module (RA-98)

Reference frontend module mirroring the backend's `ReAccreditationType`. All
files live under `src/server/work-items/re-accreditation/`:

| File                                          | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module.js`                                   | Exports `reAccreditationModule = { type, register }`. The `type` block declares `detailTemplate`, states (`submitted`, `duly-made`, `assessment-in-progress`, `awaiting-decision`, terminal `approved` / `rejected` / `withdrawn`), per-state tasks and the transitions in lock-step with the backend. The `register` callback mounts the approval and (feature-flagged) create routes; the detail template is resolved from `type.detailTemplate`. |
| `module.test.js`                              | Verifies the module passes `assertValidWorkItemModule`, that the type's shape matches expectations (including `detailTemplate`), and that the transitions and per-state tasks are correct.                                                                                                                                                                                                                                                          |
| `../../routes/re-accreditation/detail-v1.njk` | Type-specific detail template for re-accreditation work items. Extends `work-items/detail.njk` so it inherits summary, tasks, actions, notes and the audit-log link, and layers re-accreditation-specific content on top.                                                                                                                                                                                                                           |

Wired into the application by a single line in `src/server/work-items/modules.js`:

```js
import { reAccreditationModule } from './re-accreditation/module.js'
export const workItemModules = [reAccreditationModule]
```

The states / tasks / transitions are placeholders for the PoC per the AC; the
intended workflow diagram is referenced in RA-85.
