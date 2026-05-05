/**
 * Audit log helpers (RA-97).
 *
 * The backend appends one `auditLog` entry to a work item for every
 * successful state-changing engine call (task completion, action
 * application, assignment / unassignment, note added). Entries arrive
 * already sorted chronologically (oldest-first). The detail template
 * renders them as a top-to-bottom timeline; this helper produces a short
 * human-readable `summary` per entry from the structured `details`
 * dictionary so the template can stay declarative.
 */

/**
 * Decorate the raw audit log from a backend `WorkItemResponse` with a
 * `summary` string suitable for direct rendering. Returns the entries in
 * the same chronological order the backend projected them.
 */
export function decorateAuditLog(entries) {
  if (!Array.isArray(entries)) {
    return []
  }
  return entries.map((entry) => ({
    ...entry,
    summary: summariseAuditEntry(entry),
    detailRows: detailRowsForAuditEntry(entry)
  }))
}

/**
 * Build a one-line summary of an audit entry from its `action` and
 * `details`. Falls back to an empty string when there is nothing useful to
 * add (the template already shows the action display name).
 */
export function summariseAuditEntry(entry) {
  if (entry == null || typeof entry !== 'object') {
    return ''
  }
  const details = entry.details ?? {}
  switch (entry.action) {
    case 'task-completed':
      return details.taskDisplayName ?? details.taskId ?? ''
    case 'action-applied': {
      const action = details.actionDisplayName ?? details.actionId ?? ''
      const from = details.fromStateId
      const to = details.toStateId
      if (from && to) {
        return action ? `${action} (${from} → ${to})` : `${from} → ${to}`
      }
      return action
    }
    case 'assigned': {
      const to = details.assigneeName ?? details.assigneeId ?? 'unknown user'
      const from = details.previousAssigneeName ?? details.previousAssigneeId
      return from ? `${from} → ${to}` : to
    }
    case 'unassigned': {
      const from = details.previousAssigneeName ?? details.previousAssigneeId
      return from ? `was ${from}` : ''
    }
    case 'note-added':
      return ''
    default:
      return ''
  }
}

/**
 * Project the structured `details` of an audit entry into a list of
 * `{ key, value, multiline? }` rows suitable for rendering inside a
 * disclosure (`<details>` / `govuk-details`). Returns an empty array when
 * the entry has nothing extra worth surfacing — the template should then
 * skip the disclosure entirely.
 *
 * Set `multiline: true` to tell the template to preserve newlines in the
 * value (paragraph-per-line). Otherwise the value renders inline.
 */
export function detailRowsForAuditEntry(entry) {
  if (entry == null || typeof entry !== 'object') {
    return []
  }
  const details = entry.details ?? {}
  switch (entry.action) {
    case 'work-item-submitted': {
      const rows = []
      if (details.typeId) rows.push({ key: 'Type', value: details.typeId })
      if (details.stateId) {
        rows.push({ key: 'Initial state', value: details.stateId })
      }
      if (details.templateVersion) {
        rows.push({ key: 'Template version', value: details.templateVersion })
      }
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) rows.push({ key: 'Submitted by', value: actor })
      return rows
    }
    case 'task-completed': {
      const rows = []
      const task = details.taskDisplayName ?? details.taskId
      if (task) rows.push({ key: 'Task', value: task })
      if (details.stateId) rows.push({ key: 'State', value: details.stateId })
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) rows.push({ key: 'Completed by', value: actor })
      return rows
    }
    case 'action-applied': {
      const rows = []
      const action = details.actionDisplayName ?? details.actionId
      if (action) rows.push({ key: 'Action', value: action })
      if (details.fromStateId) {
        rows.push({ key: 'Previous state', value: details.fromStateId })
      }
      if (details.toStateId) {
        rows.push({ key: 'New state', value: details.toStateId })
      }
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) rows.push({ key: 'Applied by', value: actor })
      return rows
    }
    case 'note-added': {
      const rows = []
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) rows.push({ key: 'Added by', value: actor })
      const text = details.noteText
      if (typeof text === 'string' && text.length > 0) {
        rows.push({ key: 'Note', value: text, multiline: true })
      }
      return rows
    }
    case 'task-status-changed': {
      const rows = []
      const task = details.taskDisplayName ?? details.taskId
      if (task) rows.push({ key: 'Task', value: task })
      if (details.stateId) rows.push({ key: 'State', value: details.stateId })
      if (details.fromStatus) {
        rows.push({ key: 'Previous status', value: details.fromStatus })
      }
      if (details.toStatus) {
        rows.push({ key: 'New status', value: details.toStatus })
      }
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) rows.push({ key: 'Changed by', value: actor })
      return rows
    }
    case 'assigned': {
      const rows = []
      const previous =
        details.previousAssigneeName ?? details.previousAssigneeId
      const next = details.assigneeName ?? details.assigneeId
      rows.push({ key: 'Previously assigned to', value: previous ?? 'Nobody' })
      if (next) rows.push({ key: 'Now assigned to', value: next })
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) rows.push({ key: 'Assigned by', value: actor })
      return rows
    }
    case 'unassigned': {
      const rows = []
      const previous =
        details.previousAssigneeName ?? details.previousAssigneeId
      if (previous) {
        rows.push({ key: 'Previously assigned to', value: previous })
      }
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) rows.push({ key: 'Unassigned by', value: actor })
      return rows
    }
    default:
      return []
  }
}
