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
 *
 * RA-782. The same read says whether the work item takes a payment date
 * (`takesPaymentDate`), so management-be, which refuses a date it does not
 * take, decides it once. The type's own `standardLifecycle.paymentDate` is
 * only the fallback, for when management-be's answer is not to hand.
 */

import { getDulyMakeDetails } from '#/server/common/helpers/backend-api/backend-api.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { relatedWorkItemRow } from '#/server/routes/work-items/related-requests.js'

import { getStandardLifecycle, takesPaymentDate } from '../lifecycle.js'

const logger = createLogger()

/**
 * @param {object} args
 * @param {string} args.typeId the type whose Duly make page is rendering
 * @param {string} args.workItemId
 * @param {object|null} args.user
 * @returns {Promise<{ relatedWorkItems: null | { unavailable: true } | { rows: object[] }, takesPaymentDate: boolean }>}
 *   `relatedWorkItems` is null when the type does not list related work items
 */
export async function loadDulyMakeDetails({ typeId, workItemId, user }) {
  const fallback = takesPaymentDate(typeId)
  if (getStandardLifecycle(typeId)?.relatedWorkItems !== true) {
    return { relatedWorkItems: null, takesPaymentDate: fallback }
  }

  const result = await getDulyMakeDetails({ workItemId, user })
  if (!result?.ok) {
    logger.warn(
      { workItemId, typeId, status: result?.status, error: result?.error },
      'Related change requests could not be loaded for duly making'
    )
    return {
      relatedWorkItems: { unavailable: true },
      takesPaymentDate: fallback
    }
  }

  const details = result.details ?? {}
  return {
    relatedWorkItems: relatedRows(details.relatedWorkItems ?? [], workItemId),
    takesPaymentDate:
      typeof details.takesPaymentDate === 'boolean'
        ? details.takesPaymentDate
        : fallback
  }
}

function relatedRows(related, workItemId) {
  // "Anything besides this one" rather than a row count, so a backend that
  // still leaves the current work item out lists the same submissions.
  if (!related.some(({ id }) => id !== workItemId)) {
    return { rows: [] }
  }
  return { rows: related.map(relatedWorkItemRow) }
}
