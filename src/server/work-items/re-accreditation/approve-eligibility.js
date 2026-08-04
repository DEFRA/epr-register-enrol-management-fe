/**
 * Single gate for the re-accreditation "Approve determination" flow (RA-346).
 *
 * `approve` is NOT a generic engine action. It runs through the bespoke
 * two-step flow in `./approval/` against the type-specific backend endpoint
 * `POST /work-items/re-accreditation/{id}/approve`, so it never appears in
 * the backend's `availableActions` — which means the task-completion filter
 * in `core/engine.js#projectWorkItem` that gates every other action never
 * applied to it. That is the RA-346 bug: the Approve CTA was offered, and
 * approval succeeded, while the `awaiting-decision` task
 * `record-decision-rationale` was still pending.
 *
 * The fix is deliberately NOT a second parallel rule. `module.js` already
 * declares the `approve` transition with `requiresAllTasksComplete: true`;
 * this helper asks the engine whether that declaration permits the action
 * right now, so the declaration is what actually governs. The state check
 * comes along for free because the same transition declares
 * `fromStateId: 'awaiting-decision'`.
 *
 * Used by BOTH the CTA visibility check (`work-items/detail.controller.js`)
 * and the approve route's own guard (`./approval/controller.js`), so the
 * button and the URL can never disagree.
 *
 * The backend remains authoritative — it applies its own server-side gate
 * and rejects a forged POST regardless of what this says.
 */

import { canApplyAction } from '../core/engine.js'
import { getWorkItemType } from '../core/registry.js'

export const RE_ACCREDITATION_TYPE_ID = 're-accreditation'
export const APPROVE_ACTION_ID = 'approve'

/**
 * Can this work item be approved right now?
 *
 * @param {object} workItem A work item as returned by the backend (its own
 *   `tasks` array is authoritative when present).
 * @returns {{ allowed: boolean, reason?: string }} `reason` is the engine's
 *   rejection code — notably `'incomplete-tasks'` when a decision task is
 *   still pending, and `'invalid-transition'` / `'terminal-state'` when the
 *   item is not in `awaiting-decision`.
 */
export function evaluateApproveEligibility(workItem) {
  if (
    workItem?.typeId != null &&
    workItem.typeId !== RE_ACCREDITATION_TYPE_ID
  ) {
    return { allowed: false, reason: 'wrong-type' }
  }

  const type = getWorkItemType(RE_ACCREDITATION_TYPE_ID)
  if (!type) {
    // The module is not registered (only reachable in a partially-wired
    // test server). Fail CLOSED: never offer an approval we cannot verify.
    return { allowed: false, reason: 'unknown-action' }
  }

  return canApplyAction(type, workItem, APPROVE_ACTION_ID)
}
