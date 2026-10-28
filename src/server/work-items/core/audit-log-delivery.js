/**
 * Audit log detail rows for delivery to systems outside the Case Management
 * service: GOV.UK Notify notifications and Registration & Accreditation
 * service status pushes. Split out of `audit-log.js` to keep that module
 * within size limits; `detailRowsForAuditEntry` dispatches here.
 */

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
export function notificationDetailRows(entry, details) {
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
export function statusPushDetailRows(entry, details) {
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
