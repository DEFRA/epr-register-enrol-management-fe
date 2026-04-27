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
    summary: summariseAuditEntry(entry)
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
