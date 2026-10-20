/**
 * "Ensure assessment started" (RA-595): the step a regulator's submit runs
 * before posting work the backend only accepts once a case is started.
 *
 * Make Determination and Change determination deadline are
 * offered on a Duly made case, but management-be still refuses a decision or
 * `sla-extend` from `duly-made`. So the submit runs this first. When the item
 * sits in the `fromStateId` of its type's `startsOnSelfAssign` transition
 * (re-accreditation: `duly-made` -> `start-assessment`):
 *
 *   1. assign it to the current user, ONLY if it is unassigned. A colleague
 *      who holds it stays assigned: submitting a decision must not silently
 *      take over their work.
 *   2. apply the start transition.
 *
 * In any other state it does nothing and makes no backend call, so a
 * resubmit after a later failure skips straight past it.
 *
 * Type-agnostic on purpose: the marker, the state and the action id all come
 * from the module declaration through `resolveSelfAssignTransition`, the same
 * lookup "Assign to yourself and start" uses. Shared work-item code learns
 * nothing about re-accreditation.
 *
 * Partial failure is reported, never rolled back, mirroring self-assign:
 *
 *  - assign fails -> nothing else is called. `{ ok: false, failedStep: 'assign' }`
 *  - start fails  -> the assignment (if any) stands, the item stays where it
 *    was with every action, and a resubmit retries: it is now assigned, so
 *    only the start is repeated. `{ ok: false, failedStep: 'start', assigned }`
 *
 * Page loads must never call this — opening a page changes nothing.
 *
 * Callers: the decision submit and the deadline-change submit
 * (`routes/work-items/sla.controller.js`). "Assign to yourself and start"
 * ALWAYS assigns (taking over a colleague's case), so folding it in needs an
 * always-assign option; it still runs its own copy today.
 */

import { resolveSelfAssignTransition } from './engine.js'
import { getWorkItemType } from './registry.js'
import { createWorkItemActionsService } from './service.js'

/**
 * @param {object} args
 * @param {object} args.workItem The RAW backend DTO, freshly read by the
 *   submit handler.
 * @param {{ id?: string, name?: string }|null} args.user The current user.
 * @param {object} [args.service] A work-item actions service (tests inject
 *   one). Created only when a start is actually needed.
 * @returns {Promise<
 *   | { ok: true, assigned: boolean, started: boolean }
 *   | { ok: false, failedStep: 'assign'|'start', assigned: boolean, result: object }
 * >}
 */
export async function ensureAssessmentStarted({ workItem, user, service }) {
  const start = resolveSelfAssignTransition(
    getWorkItemType(workItem?.typeId),
    workItem
  )
  if (start == null) {
    return { ok: true, assigned: false, started: false }
  }

  const actions = service ?? createWorkItemActionsService()
  let assigned = false

  if (workItem.assignedToId == null) {
    if (user?.id == null) {
      return {
        ok: false,
        failedStep: 'assign',
        assigned: false,
        result: {
          ok: false,
          reason: 'invalid',
          message: 'Could not identify the current user.'
        }
      }
    }
    const assignResult = await actions.assign({
      workItemId: workItem.id,
      assigneeId: user.id,
      assigneeName: user.name ?? null,
      user
    })
    if (!assignResult.ok) {
      return {
        ok: false,
        failedStep: 'assign',
        assigned: false,
        result: assignResult
      }
    }
    assigned = true
  }

  const startResult = await actions.applyAction({
    workItemId: workItem.id,
    actionId: start.actionId,
    user
  })
  if (!startResult.ok) {
    return { ok: false, failedStep: 'start', assigned, result: startResult }
  }

  return { ok: true, assigned, started: true }
}

/**
 * The half of a failed step that DID land, for the start of an error
 * message — following the self-assign pattern ("This application has been
 * assigned to you, but it could not be started"), so the regulator never
 * reads a partial failure as "nothing happened" or "everything failed".
 *
 * @param {{ failedStep: 'assign'|'start', assigned: boolean }} outcome
 * @returns {string} A clause with no trailing punctuation.
 */
export function describeStartFailure({ failedStep, assigned }) {
  if (failedStep === 'assign') {
    return 'This application could not be assigned to you'
  }
  if (assigned) {
    return 'This application has been assigned to you, but it could not be started'
  }
  return 'This application could not be started'
}

/**
 * What a SUCCESSFUL step did, for prefixing the message when the work that
 * follows it fails — or `null` when the step did nothing.
 *
 * @param {{ assigned: boolean, started: boolean }} outcome
 * @returns {string|null} A full sentence, or `null`.
 */
export function describeStartSuccess({ assigned, started }) {
  if (!started) {
    return null
  }
  if (assigned) {
    return 'This application has been assigned to you and started.'
  }
  return 'This application has been started.'
}
