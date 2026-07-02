import { formatDateTimeGds } from '#/config/nunjucks/filters/format-date.js'

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
 *
 * The optional `payload` is the current work item payload; when supplied
 * it is surfaced as a `Payload` row on the `work-item-submitted` entry
 * so the original submission body lives with its audit record rather
 * than as a stand-alone panel on the detail page (RA-186).
 *
 * The optional `workItemSnapshot` adds a consistent set of work-item
 * context rows (Org ID, Type, State, Submitted at, Submitted by,
 * Last modified, Assigned to) to the disclosure of every audit entry.
 */
export function decorateAuditLog(entries, { payload, workItemSnapshot } = {}) {
  if (!Array.isArray(entries)) {
    return []
  }
  const snapshotRows = buildSnapshotRows(workItemSnapshot)
  return entries.map((entry) => ({
    ...entry,
    actionDisplayName: actionDisplayNameFor(entry),
    summary: summariseAuditEntry(entry),
    isFailure: isFailureAuditEntry(entry),
    detailRows: [
      ...detailRowsForAuditEntry(entry, { payload }),
      ...snapshotRows
    ]
  }))
}

/**
 * Build the fixed work-item context rows that appear in the "Show details"
 * disclosure of every audit entry. Returns an empty array when no snapshot
 * is supplied so callers that don't need this context are unaffected.
 */
function buildSnapshotRows(snapshot) {
  if (snapshot == null || typeof snapshot !== 'object') return []
  const rows = []
  if (snapshot.orgId) rows.push({ key: 'Org ID', value: snapshot.orgId })
  if (snapshot.typeDisplayName) {
    rows.push({ key: 'Type', value: snapshot.typeDisplayName })
  }
  if (snapshot.stateDisplayName) {
    rows.push({ key: 'State', value: snapshot.stateDisplayName })
  }
  const submittedAt = formatDateTimeGds(snapshot.submittedAt)
  if (submittedAt) rows.push({ key: 'Submitted at', value: submittedAt })
  if (snapshot.submittedBy) {
    rows.push({ key: 'Submitted by', value: snapshot.submittedBy })
  }
  const lastModified = formatDateTimeGds(snapshot.lastModifiedAt)
  if (lastModified) rows.push({ key: 'Last modified', value: lastModified })
  rows.push({
    key: 'Assigned to',
    value: snapshot.assignedToName ?? 'Unassigned'
  })
  return rows
}

/**
 * Humanised label for the audit timeline. Falls back to a per-action
 * lookup when the backend hasn't supplied an `actionDisplayName` (e.g.
 * for newer audit actions added before the backend humaniser caught up,
 * such as RA-129's `task-note-added`).
 */
const ACTION_DISPLAY_NAMES = {
  'work-item-submitted': 'Work item submitted',
  'task-completed': 'Task completed',
  'task-status-changed': 'Task status changed',
  'action-applied': 'Action applied',
  assigned: 'Assigned',
  unassigned: 'Unassigned',
  'note-added': 'Note added',
  'task-note-added': 'Task note added',
  'notification-sent': 'Notification sent',
  'notification-skipped': 'Notification not sent',
  'notification-failed': 'Notification failed'
}

/**
 * Audit actions that record a failed regulator notification. These render
 * in a visually distinct (error-styled) way on the audit-log page (RA-234)
 * so notification failures are obviously displayed rather than buried as
 * another grey timeline row.
 */
const FAILURE_ACTIONS = new Set(['notification-failed'])

function isFailureAuditEntry(entry) {
  if (entry == null || typeof entry !== 'object') return false
  return FAILURE_ACTIONS.has(entry.action)
}

function actionDisplayNameFor(entry) {
  if (entry == null || typeof entry !== 'object') return ''
  if (
    typeof entry.actionDisplayName === 'string' &&
    entry.actionDisplayName.trim() !== ''
  ) {
    return entry.actionDisplayName
  }
  return ACTION_DISPLAY_NAMES[entry.action] ?? entry.action ?? ''
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
    case 'task-note-added': {
      const task = details.taskDisplayName ?? details.taskId
      const excerpt =
        typeof details.excerpt === 'string' ? details.excerpt.trim() : ''
      if (task && excerpt) return `${task} \u2014 \u201c${excerpt}\u201d`
      if (task) return task
      return excerpt ? `\u201c${excerpt}\u201d` : ''
    }
    case 'notification-sent':
      return details.recipient ?? ''
    case 'notification-skipped':
      return details.reason ?? ''
    case 'notification-failed':
      return details.errorMessage ?? ''
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
 * value (paragraph-per-line). Set `preformatted: true` to render the
 * value inside a monospace `<pre>` block, preserving all whitespace
 * verbatim (used for the JSON payload row). Otherwise the value renders
 * inline.
 */
export function detailRowsForAuditEntry(entry, { payload } = {}) {
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
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) rows.push({ key: 'Submitted by', value: actor })
      const payloadJson = formatPayloadForAudit(payload)
      if (payloadJson !== '') {
        rows.push({ key: 'Payload', value: payloadJson, preformatted: true })
      }
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
    case 'task-note-added': {
      const rows = []
      const task = details.taskDisplayName ?? details.taskId
      if (task) rows.push({ key: 'Task', value: task })
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) rows.push({ key: 'Added by', value: actor })
      const excerpt = details.excerpt
      if (typeof excerpt === 'string' && excerpt.length > 0) {
        rows.push({ key: 'Excerpt', value: excerpt, multiline: true })
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
    case 'notification-sent':
    case 'notification-skipped':
    case 'notification-failed':
      return notificationDetailRows(entry, details)
    default:
      return []
  }
}

/**
 * Project the structured details of a notification audit entry (RA-234).
 *
 * The backend's `ReAccreditationNotificationHook.SendAndRecordAsync` stamps
 * these fields onto the entry's `details` dictionary:
 *   - `templateKey`        — the GOV.UK Notify template that was (or would
 *                            have been) used; surfaced as "Notification type".
 *   - `recipient`          — the operator email (sent / failed only; absent
 *                            on a skip, which never resolved a recipient).
 *   - `reference`          — the Notify client reference (the work item id).
 *   - `providerMessageId`  — the Notify message id (sent / failed; may be
 *                            null on a failure that never reached Notify).
 *   - `reason`             — why a send was skipped (skipped only, e.g.
 *                            "missing-operator-email").
 *   - `errorMessage`       — the Notify error text (failed only).
 *
 * Only fields actually present on the entry are rendered, mirroring the
 * other audit actions; we never invent rows for absent fields.
 */
function notificationDetailRows(entry, details) {
  const rows = []
  if (details.templateKey) {
    rows.push({ key: 'Notification type', value: details.templateKey })
  }
  if (details.recipient) {
    rows.push({ key: 'Recipient', value: details.recipient })
  }
  if (details.reference) {
    rows.push({ key: 'Reference', value: details.reference })
  }
  if (details.providerMessageId) {
    rows.push({ key: 'Provider message ID', value: details.providerMessageId })
  }
  if (details.reason) {
    rows.push({ key: 'Reason', value: details.reason })
  }
  if (details.errorMessage) {
    rows.push({ key: 'Error', value: details.errorMessage, multiline: true })
  }
  const actor = entry.createdByName ?? entry.createdBy
  if (actor) rows.push({ key: 'Triggered by', value: actor })
  return rows
}

function formatPayloadForAudit(payload) {
  if (payload == null) return ''
  if (typeof payload === 'string') {
    return payload.trim() === '' ? '' : payload
  }
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return ''
  }
}
