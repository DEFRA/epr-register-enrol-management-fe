/**
 * RA-495. The shared Standard-workflow lifecycle: the Duly make, Make
 * determination, Confirm applicant contact and (RA-800) Change valid from
 * date pages, their eligibility checks, the detail-page CTAs and the
 * pending-contact banner. Any case type
 * on the Standard workflow can opt in by declaring `standardLifecycle` on its
 * type and mounting `buildStandardLifecycleRoutes(type.id)` from its module's
 * `register(server)`:
 *
 *   standardLifecycle: {
 *     // Required. The raw payment values the Duly make page shows; the
 *     // shared page formats them and says "Not provided" for a missing one.
 *     readPaymentDetails: (workItem) => ({ chargePence, paymentReference }),
 *     // Optional. The management-be calls. Each defaults to the type-less
 *     // Standard-lifecycle endpoint (`/work-items/{id}/duly-make` etc.).
 *     backend: { dulyMake, recordDecision, confirmContact, changeValidFrom },
 *     // Optional. When true the Duly make page lists every work item from
 *     // the same submission, this one included ("Related change
 *     // requests"), read from management-be's
 *     // `GET /work-items/{id}/duly-make`; none for a one-site submission.
 *     relatedWorkItems: true,
 *     // Optional. The "Applicant contacted" success banner's copy by
 *     // outcome, `{ title, text }` each; an outcome left out keeps the
 *     // default (accreditation granted / refused).
 *     contactConfirmedBanners: { approved, rejected },
 *     // Optional. RA-495 AC6: when true the Make determination page asks
 *     // for a valid from date, required on approval and hidden on refusal
 *     // (see `decision/effective-date.js`), and (RA-800) it can be
 *     // corrected while the approval awaits applicant contact.
 *     effectiveDate: true,
 *     // Optional. RA-782: false for a type that is never charged (an ORS
 *     // update): its Duly make page asks for no payment date, shows the
 *     // charge and payment reference as "-", and sends management-be no
 *     // date (management-be refuses one for such a type). Default true.
 *     paymentDate: false
 *   }
 *
 * The pages live under `/work-items/{typeId}/{id}/…`, so re-accreditation's
 * keep their existing URLs. Their copy, status labels and badges are the
 * same for every type (the Standard workflow's).
 */

import { getWorkItemType } from '../registry.js'

export const DULY_MAKE_PAGE = 'duly-make'
export const DECISION_PAGE = 'decision'
export const CONFIRM_CONTACT_PAGE = 'confirm-contact'
// RA-800. Correct the valid from date while a determination awaits contact.
export const CHANGE_VALID_FROM_PAGE = 'change-valid-from'

/**
 * The URL of one of a type's lifecycle pages for a work item.
 *
 * @param {string} typeId
 * @param {string} id work item id
 * @param {string} page one of the `*_PAGE` constants
 * @returns {string}
 */
export function lifecyclePageHref(typeId, id, page) {
  return `/work-items/${encodeURIComponent(typeId)}/${encodeURIComponent(id)}/${page}`
}

/**
 * The route path of one of a type's lifecycle pages.
 *
 * @param {string} typeId
 * @param {string} page one of the `*_PAGE` constants
 * @returns {string}
 */
export function lifecycleRoutePath(typeId, page) {
  return `/work-items/${typeId}/{id}/${page}`
}

/**
 * The type's Standard-lifecycle declaration, or null when the type is not
 * registered or has not opted in.
 *
 * @param {string | null | undefined} typeId
 * @returns {object | null}
 */
export function getStandardLifecycle(typeId) {
  return getWorkItemType(typeId)?.standardLifecycle ?? null
}

/**
 * RA-495 AC6: does the type's Make determination page take an effective date?
 *
 * @param {string | null | undefined} typeId
 * @returns {boolean}
 */
export function takesEffectiveDate(typeId) {
  return getStandardLifecycle(typeId)?.effectiveDate === true
}

/**
 * RA-782: does the type's Duly make page take a payment date? Every type does
 * unless it declares `standardLifecycle.paymentDate: false`, so an unknown
 * type keeps the date (and management-be's own check decides).
 *
 * @param {string | null | undefined} typeId
 * @returns {boolean}
 */
export function takesPaymentDate(typeId) {
  return getStandardLifecycle(typeId)?.paymentDate !== false
}

/**
 * Has this work item's type opted into the Standard lifecycle?
 *
 * @param {{ typeId?: string } | null | undefined} workItem
 * @returns {boolean}
 */
export function usesStandardLifecycle(workItem) {
  return getStandardLifecycle(workItem?.typeId) !== null
}

/**
 * The type a lifecycle page or CTA is scoped to, for an eligibility check.
 *
 * Every lifecycle route lives under its type's prefix, and nothing
 * guarantees the work item behind an arbitrary `{id}` IS of that type, so a
 * work item of another type is refused (`wrong-type`). An unregistered type
 * is a wiring fault, not a user error: refused distinctly
 * (`type-not-registered`) and logged, so whoever hits it looks at the server
 * wiring rather than at the work item.
 *
 * @param {object} workItem the RAW backend DTO
 * @param {string} typeId the type the route or CTA belongs to
 * @param {{ error: Function }} logger
 * @param {string} purpose what was refused, for the log
 * @returns {{ type: object } | { reason: string }}
 */
export function resolveScopedType(workItem, typeId, logger, purpose) {
  if (workItem?.typeId != null && workItem.typeId !== typeId) {
    return { reason: 'wrong-type' }
  }
  const type = getWorkItemType(typeId)
  if (!type) {
    logger.error(
      { typeId },
      `Work item type is not registered; refusing ${purpose}`
    )
    return { reason: 'type-not-registered' }
  }
  return { type }
}

async function backendApi() {
  return import('#/server/common/helpers/backend-api/backend-api.js')
}

/**
 * A `standardLifecycle.backend` for the management-be lifecycle endpoints
 * under `/work-items/{typeSegment}/{id}/…`, or the type-less ones when no
 * segment is given. The client is loaded lazily so tests can stub it without
 * mocking `undici`.
 *
 * @param {string | null} [typeSegment]
 * @returns {{ dulyMake: Function, recordDecision: Function, confirmContact: Function, changeValidFrom: Function }}
 */
export function buildLifecycleBackend(typeSegment = null) {
  const withSegment = (args) => (typeSegment ? { ...args, typeSegment } : args)
  return Object.freeze({
    dulyMake: async (args) =>
      (await backendApi()).dulyMakeWorkItem(withSegment(args)),
    recordDecision: async (args) =>
      (await backendApi()).recordWorkItemDecision(withSegment(args)),
    confirmContact: async (args) =>
      (await backendApi()).confirmWorkItemApplicantContact(withSegment(args)),
    changeValidFrom: async (args) =>
      (await backendApi()).changeValidFromWorkItem(withSegment(args))
  })
}

const DEFAULT_BACKEND = buildLifecycleBackend()

/**
 * The management-be call a type uses for one lifecycle step: its own when it
 * declares one, otherwise the type-less endpoint.
 *
 * @param {string} typeId
 * @param {'dulyMake' | 'recordDecision' | 'confirmContact' | 'changeValidFrom'} step
 * @returns {Function}
 */
export function lifecycleBackendCall(typeId, step) {
  return getStandardLifecycle(typeId)?.backend?.[step] ?? DEFAULT_BACKEND[step]
}
