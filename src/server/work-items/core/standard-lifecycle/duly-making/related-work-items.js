/**
 * RA-495. The "Related change requests" on the Duly make page: every work
 * item from the same submission, the one being duly made included, in
 * management-be's order (application reference), so the caseworker can see
 * the whole payment (user decision 2026-11-18). management-be matches them
 * on the submission reference. Shown only for a type that declares
 * `standardLifecycle.relatedWorkItems`, and only when the submission has
 * more than one site: a lone row for the current work item tells the
 * caseworker nothing the page does not already.
 *
 * Read-only: reference, site, type, charge and current status, each row
 * built as on the Related change requests tab (RA-770). A failed read
 * never blocks duly making; the page says the list could not be loaded.
 */

import { getDulyMakeDetails } from '#/server/common/helpers/backend-api/backend-api.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { relatedWorkItemRow } from '#/server/routes/work-items/related-requests.js'

import { getStandardLifecycle } from '../lifecycle.js'

const logger = createLogger()

/**
 * @param {object} args
 * @param {string} args.typeId the type whose Duly make page is rendering
 * @param {string} args.workItemId
 * @param {object|null} args.user
 * @returns {Promise<null | { unavailable: true } | { rows: object[] }>} null
 *   when the type does not list related work items
 */
export async function loadRelatedWorkItems({ typeId, workItemId, user }) {
  if (getStandardLifecycle(typeId)?.relatedWorkItems !== true) {
    return null
  }

  const result = await getDulyMakeDetails({ workItemId, user })
  if (!result.ok) {
    logger.warn(
      { workItemId, typeId, status: result.status, error: result.error },
      'Related change requests could not be loaded for duly making'
    )
    return { unavailable: true }
  }

  const related = result.details?.relatedWorkItems ?? []
  // "Anything besides this one" rather than a row count, so a backend that
  // still leaves the current work item out lists the same submissions.
  if (!related.some(({ id }) => id !== workItemId)) {
    return { rows: [] }
  }
  return { rows: related.map(relatedWorkItemRow) }
}
