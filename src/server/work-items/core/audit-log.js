import { formatDateTimeGds } from '#/config/nunjucks/filters/format-date.js'

/**
 * Audit log helpers (RA-97).
 *
 * The backend appends one `auditLog` entry to a work item for every
 * successful state-changing engine call (action
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
 *
 * The "State" row is special: it is per-entry, resolved from each entry's
 * OWN `stateId` (the work-item state as-of that event — epr-rr9s) via the
 * optional `resolveStateDisplayName(stateId)` callback, NOT from the live
 * work-item state on the snapshot. Passing the live state onto every entry
 * was the historical-state bug this contract fixes.
 */
export function decorateAuditLog(
  entries,
  { payload, workItemSnapshot, resolveStateDisplayName } = {}
) {
  if (!Array.isArray(entries)) {
    return []
  }
  return entries.map((entry) => ({
    ...entry,
    actionDisplayName: actionDisplayNameFor(entry),
    summary: summariseAuditEntry(entry),
    isFailure: isFailureAuditEntry(entry),
    detailRows: [
      ...detailRowsForAuditEntry(entry, { payload }),
      ...buildSnapshotRows(workItemSnapshot, entry, resolveStateDisplayName)
    ]
  }))
}

/**
 * Audit actions whose own event-specific detail rows already state the
 * work item's resulting (as-of) state. For these we suppress the
 * context-block "State" row so the same value is not shown twice on the
 * one entry:
 *
 *   - `work-item-submitted`  — Initial state (`details.stateId`)
 *   - `action-applied`       — Previous / New state
 *   - `status-push-sent` / `status-push-skipped` / `status-push-failed`
 *     — Previous / New state, via `statusPushDetailRows`
 *
 * The status-push actions matter especially: their `New state` row reads
 * `details.toStateDisplayName ?? details.toStateId`, the vocabulary the
 * push hook recorded for the Registration & Accreditation service, while
 * the context row would resolve `entry.stateId` through the Case
 * Management service's `type.states` display names. Left unsuppressed, one
 * entry could show `New state: <Registration & Accreditation service
 * label>` alongside `State: <Case Management service label>` for the same
 * state.
 *
 * Every other action — assignment, notes, notifications, and the retired
 * `task-completed` / `task-status-changed` entries — carries no state in
 * its own rows, so it DOES get the context-block State row: that is where
 * a caseworker learns which state the item was in when the event happened.
 *
 * RA-410 removed the task framework and purged the `task-completed` /
 * `task-status-changed` cases from `detailRowsForAuditEntry`, so those
 * actions no longer render a State row of their own. They are therefore
 * NOT in this set: a historical task entry that carries a per-entry
 * `stateId` now surfaces it through the context-block row like any other
 * auxiliary action (and old task entries with no `stateId` simply omit
 * it), rather than being silently suppressed.
 */
const ACTION_WORK_ITEM_SUBMITTED = 'work-item-submitted'
const ACTION_APPLIED = 'action-applied'
const ACTION_ASSIGNED = 'assigned'
const ACTION_UNASSIGNED = 'unassigned'
const ACTION_NOTE_ADDED = 'note-added'
const ACTION_NOTIFICATION_SENT = 'notification-sent'
const ACTION_NOTIFICATION_SKIPPED = 'notification-skipped'
const ACTION_NOTIFICATION_FAILED = 'notification-failed'
const ACTION_STATUS_PUSH_SENT = 'status-push-sent'
const ACTION_STATUS_PUSH_SKIPPED = 'status-push-skipped'
const ACTION_STATUS_PUSH_FAILED = 'status-push-failed'
const ACTION_ROUTED_TO_NATION = 'routed-to-nation'

const STATE_BEARING_ACTIONS = new Set([
  ACTION_WORK_ITEM_SUBMITTED,
  ACTION_APPLIED,
  ACTION_STATUS_PUSH_SENT,
  ACTION_STATUS_PUSH_SKIPPED,
  ACTION_STATUS_PUSH_FAILED
])

/**
 * Build the context-block "State" row for a single audit entry from that
 * entry's OWN `stateId` (epr-rr9s): the work-item state as-of the event,
 * resolved to a display name via the SAME state-definition machinery the
 * controller uses for the live state. Returns null when the row should be
 * omitted:
 *   - the entry already conveys its resulting state in its own rows (see
 *     STATE_BEARING_ACTIONS), or
 *   - the entry has no `stateId` (older documents predating the backend
 *     change). We NEVER fall back to the current work-item state here —
 *     that is exactly the bug this fixes.
 */
function buildEntryStateRow(entry, resolveStateDisplayName) {
  if (entry == null || typeof entry !== 'object') {
    return null
  }
  if (STATE_BEARING_ACTIONS.has(entry.action)) {
    return null
  }
  const stateId = entry.stateId
  if (stateId == null || stateId === '') {
    return null
  }
  const value =
    typeof resolveStateDisplayName === 'function'
      ? resolveStateDisplayName(stateId)
      : stateId
  if (value == null || value === '') {
    return null
  }
  return { key: 'State', value }
}

/**
 * Build the work-item context rows that appear in the "Show details"
 * disclosure of an audit entry. Returns an empty array when no snapshot is
 * supplied so callers that don't need this context are unaffected. Every
 * row except "State" is the same across entries; the "State" row is
 * per-entry (see `buildEntryStateRow`).
 */
function buildSnapshotRows(snapshot, entry, resolveStateDisplayName) {
  if (snapshot == null || typeof snapshot !== 'object') {
    return []
  }
  const rows = []
  if (snapshot.orgId) {
    rows.push({ key: 'Org ID', value: snapshot.orgId })
  }
  if (snapshot.typeDisplayName) {
    rows.push({ key: 'Type', value: snapshot.typeDisplayName })
  }
  const stateRow = buildEntryStateRow(entry, resolveStateDisplayName)
  if (stateRow) {
    rows.push(stateRow)
  }
  const submittedAt = formatDateTimeGds(snapshot.submittedAt)
  if (submittedAt) {
    rows.push({ key: 'Submitted at', value: submittedAt })
  }
  if (snapshot.submittedBy) {
    rows.push({ key: 'Submitted by', value: snapshot.submittedBy })
  }
  const lastModified = formatDateTimeGds(snapshot.lastModifiedAt)
  if (lastModified) {
    rows.push({ key: 'Last modified', value: lastModified })
  }
  rows.push({
    key: 'Assigned to',
    value: snapshot.assignedToName ?? 'Unassigned'
  })
  return rows
}

/**
 * Humanised label for the audit timeline. Falls back to a per-action
 * lookup when the backend hasn't supplied an `actionDisplayName` (e.g.
 * for newer audit actions added before the backend humaniser caught up).
 */
const ACTION_DISPLAY_NAMES = {
  [ACTION_WORK_ITEM_SUBMITTED]: 'Work item submitted',
  [ACTION_APPLIED]: 'Action applied',
  [ACTION_ASSIGNED]: 'Assigned',
  [ACTION_UNASSIGNED]: 'Unassigned',
  [ACTION_NOTE_ADDED]: 'Note added',
  [ACTION_NOTIFICATION_SENT]: 'Notification sent',
  [ACTION_NOTIFICATION_SKIPPED]: 'Notification not sent',
  [ACTION_NOTIFICATION_FAILED]: 'Notification failed',
  [ACTION_STATUS_PUSH_SENT]:
    'Status sent to the Registration & Accreditation service',
  [ACTION_STATUS_PUSH_SKIPPED]:
    'Status not sent to the Registration & Accreditation service (disabled)',
  [ACTION_STATUS_PUSH_FAILED]:
    'Status failed to send to the Registration & Accreditation service',
  [ACTION_ROUTED_TO_NATION]: 'Routed to nation'
}

/**
 * Audit actions that record a failed regulator notification or a failed
 * Registration & Accreditation service status push. These render in a visually distinct (error-styled) way
 * on the audit-log page (RA-234, RA-368) so failures are obviously
 * displayed rather than buried as another grey timeline row.
 */
const FAILURE_ACTIONS = new Set([
  ACTION_NOTIFICATION_FAILED,
  ACTION_STATUS_PUSH_FAILED
])

function isFailureAuditEntry(entry) {
  if (entry == null || typeof entry !== 'object') {
    return false
  }
  return FAILURE_ACTIONS.has(entry.action)
}

/**
 * RA-211: whether a work item has an unresolved notification failure worth
 * surfacing as a banner. A `notification-failed` entry is "unresolved" when
 * no `notification-sent` entry for the SAME template appears later in the
 * (chronologically ordered) audit log — a later, unrelated notification
 * succeeding (e.g. DulyMade) must not hide an earlier, still-unresolved
 * failure of a different one (e.g. Queried). When either entry lacks a
 * `details.templateKey` (older data), falls back to treating any later
 * success as resolving it, so pre-RA-211 audit entries degrade safely
 * rather than showing a false banner forever.
 *
 * The backend only ever writes `notification-failed` after its own
 * 3-attempt retry pipeline is exhausted (see GovukNotifyClient), so there
 * is no separate "still retrying" audit state to filter out here — a
 * still-in-flight send simply hasn't written any entry yet.
 */
export function notificationFailureDetected(auditLog) {
  if (!Array.isArray(auditLog)) {
    return false
  }
  const failed = auditLog.filter(
    (entry) => entry?.action === ACTION_NOTIFICATION_FAILED
  )
  const sent = auditLog.filter(
    (entry) => entry?.action === ACTION_NOTIFICATION_SENT
  )
  return failed.some((failure) => {
    const failureTemplate = failure?.details?.templateKey
    return !sent.some((success) => {
      if (!(new Date(success.createdAt) > new Date(failure.createdAt))) {
        return false
      }
      const successTemplate = success?.details?.templateKey
      if (failureTemplate && successTemplate) {
        return successTemplate === failureTemplate
      }
      return true
    })
  })
}

function actionDisplayNameFor(entry) {
  if (entry == null || typeof entry !== 'object') {
    return ''
  }
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
    case ACTION_APPLIED: {
      const action = details.actionDisplayName ?? details.actionId ?? ''
      const from = details.fromStateId
      const to = details.toStateId
      if (from && to) {
        return action ? `${action} (${from} → ${to})` : `${from} → ${to}`
      }
      return action
    }
    case ACTION_ASSIGNED: {
      const to = details.assigneeName ?? details.assigneeId ?? 'unknown user'
      const from = details.previousAssigneeName ?? details.previousAssigneeId
      return from ? `${from} → ${to}` : to
    }
    case ACTION_UNASSIGNED: {
      const from = details.previousAssigneeName ?? details.previousAssigneeId
      return from ? `was ${from}` : ''
    }
    case ACTION_NOTE_ADDED:
      return ''
    case ACTION_NOTIFICATION_SENT:
      return details.recipient ?? ''
    case ACTION_NOTIFICATION_SKIPPED:
      return details.reason ?? ''
    case ACTION_NOTIFICATION_FAILED:
      return details.errorMessage ?? ''
    case ACTION_STATUS_PUSH_SENT:
      return details.toStateDisplayName ?? details.toStateId ?? ''
    case ACTION_STATUS_PUSH_SKIPPED:
      return details.reason ?? ''
    case ACTION_STATUS_PUSH_FAILED:
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
    case ACTION_WORK_ITEM_SUBMITTED: {
      const rows = []
      if (details.typeId) {
        rows.push({ key: 'Type', value: details.typeId })
      }
      if (details.stateId) {
        rows.push({ key: 'Initial state', value: details.stateId })
      }
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) {
        rows.push({ key: 'Submitted by', value: actor })
      }
      const payloadJson = formatPayloadForAudit(payload)
      if (payloadJson !== '') {
        rows.push({ key: 'Payload', value: payloadJson, preformatted: true })
      }
      return rows
    }
    case ACTION_APPLIED: {
      const rows = []
      const action = details.actionDisplayName ?? details.actionId
      if (action) {
        rows.push({ key: 'Action', value: action })
      }
      if (details.fromStateId) {
        rows.push({ key: 'Previous state', value: details.fromStateId })
      }
      if (details.toStateId) {
        rows.push({ key: 'New state', value: details.toStateId })
      }
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) {
        rows.push({ key: 'Applied by', value: actor })
      }
      return rows
    }
    case ACTION_ASSIGNED: {
      const rows = []
      const previous =
        details.previousAssigneeName ?? details.previousAssigneeId
      const next = details.assigneeName ?? details.assigneeId
      rows.push({ key: 'Previously assigned to', value: previous ?? 'Nobody' })
      if (next) {
        rows.push({ key: 'Now assigned to', value: next })
      }
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) {
        rows.push({ key: 'Assigned by', value: actor })
      }
      return rows
    }
    case ACTION_UNASSIGNED: {
      const rows = []
      const previous =
        details.previousAssigneeName ?? details.previousAssigneeId
      if (previous) {
        rows.push({ key: 'Previously assigned to', value: previous })
      }
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) {
        rows.push({ key: 'Unassigned by', value: actor })
      }
      return rows
    }
    case ACTION_NOTE_ADDED: {
      const rows = []
      const actor = entry.createdByName ?? entry.createdBy
      if (actor) {
        rows.push({ key: 'Added by', value: actor })
      }
      const text = details.noteText
      if (typeof text === 'string' && text.length > 0) {
        rows.push({ key: 'Note', value: text, multiline: true })
      }
      return rows
    }
    case ACTION_NOTIFICATION_SENT:
    case ACTION_NOTIFICATION_SKIPPED:
    case ACTION_NOTIFICATION_FAILED:
      return notificationDetailRows(entry, details)
    case ACTION_STATUS_PUSH_SENT:
    case ACTION_STATUS_PUSH_SKIPPED:
    case ACTION_STATUS_PUSH_FAILED:
      return statusPushDetailRows(entry, details)
    case ACTION_ROUTED_TO_NATION: {
      // RA-125: ReAccreditationNationRoutingHook stamps `nation` (and
      // `derivedFrom`, always "site-address" today) onto this entry's
      // details. This case was missing entirely, so a "Routed to nation"
      // entry rendered with no detail rows at all.
      const rows = []
      if (details.nation) {
        rows.push({ key: 'Nation', value: details.nation })
      }
      return rows
    }
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
 *   - `nation`             — the UK nation the work item routed to, which is
 *                            what selects the regulator mailbox (regulator
 *                            sends only; absent on operator-facing ones, and
 *                            null when the item was never routed).
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
  if (details.nation) {
    rows.push({ key: 'Nation', value: details.nation })
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
  if (actor) {
    rows.push({ key: 'Triggered by', value: actor })
  }
  return rows
}

/**
 * Project the structured details of a Registration & Accreditation service
 * status-push audit entry (RA-368).
 *
 * The backend's `WorkItemStatusPushHook` stamps these fields onto the
 * entry's `details` dictionary for every generic action/transition it
 * pushes on to the Registration & Accreditation service:
 *   - `actionId` / `actionDisplayName` — the Case Management service action
 *     that fired the push.
 *   - `fromStateId` / `toStateId`      — the Case Management service state
 *     transition.
 *   - `toStateDisplayName`             — the state the Registration &
 *     Accreditation service was told about.
 *   - `reason`                         — why a push was skipped (skipped
 *                                        only, e.g. push disabled).
 *   - `errorMessage`                   — the error text (failed only).
 *
 * Only fields actually present on the entry are rendered, mirroring the
 * notification detail rows above; we never invent rows for absent fields.
 */
function statusPushDetailRows(entry, details) {
  const rows = []
  const action = details.actionDisplayName ?? details.actionId
  if (action) {
    rows.push({ key: 'Action', value: action })
  }
  if (details.fromStateId) {
    rows.push({ key: 'Previous state', value: details.fromStateId })
  }
  const toState = details.toStateDisplayName ?? details.toStateId
  if (toState) {
    rows.push({ key: 'New state', value: toState })
  }
  if (details.reason) {
    rows.push({ key: 'Reason', value: details.reason })
  }
  if (details.errorMessage) {
    rows.push({ key: 'Error', value: details.errorMessage, multiline: true })
  }
  const actor = entry.createdByName ?? entry.createdBy
  if (actor) {
    rows.push({ key: 'Triggered by', value: actor })
  }
  return rows
}

function formatPayloadForAudit(payload) {
  if (payload == null) {
    return ''
  }
  if (typeof payload === 'string') {
    return payload.trim() === '' ? '' : payload
  }
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return ''
  }
}
