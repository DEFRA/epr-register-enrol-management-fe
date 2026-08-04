/**
 * Withdrawn-application notice (RA-358).
 *
 * A withdrawn work item is NEVER deleted by management-be: withdrawing is a
 * plain state transition to `withdrawn`, and `GET /work-items/{id}` has no
 * state filter, so the detail page for a withdrawn application still renders
 * a full 200. Before RA-358 the only signals that it had been withdrawn were
 * the grey `Withdrawn` state tag in the case header and the generic
 * read-only Outcome panel ("This work item is in a final state…") — neither
 * of which tells a regulator, prominently and in application terms, that the
 * application they followed a link to has been withdrawn.
 *
 * This helper lives in `core/` rather than in the re-accreditation module
 * because the message belongs to the WITHDRAWAL CONCEPT, not to one type's
 * template: `withdrawn` happens to be a re-accreditation state today, but
 * any future module that declares it gets the banner for free, and no module
 * has to opt in. It is pure — no I/O, no registry lookups — so the detail
 * controller can call it on every render.
 *
 * RA-249 rule: the notice may name the case ONLY by its human `RA-*`
 * application reference. It must never fall back to the work-item Guid — the
 * whole point of the ticket is that the system-generated id is not a
 * user-facing identifier. When no reference is available the copy degrades to
 * an unqualified sentence rather than inventing one.
 */

export const WITHDRAWN_STATE_ID = 'withdrawn'

export const WITHDRAWN_NOTICE_TITLE = 'This application has been withdrawn'

const WITHDRAWN_TAIL =
  'has been withdrawn. It can no longer be progressed and no further action is needed.'

const WITHDRAWN_TEXT_WITHOUT_REF = `This application ${WITHDRAWN_TAIL}`

/**
 * Read the human application reference off a work item, tolerating both the
 * decorated view model (`applicationRef`, set by the detail controller's
 * `decorate`) and a raw backend DTO (`payload.applicationReference`).
 *
 * Anything that is not a non-blank string is treated as absent, so a `null`,
 * an empty string or a stray non-string never reaches the copy.
 *
 * @param {object} [workItem]
 * @returns {string|null}
 */
function readApplicationRef(workItem) {
  const candidates = [
    workItem?.applicationRef,
    workItem?.payload?.applicationReference
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim()
    }
  }
  return null
}

/**
 * Build the view model for the withdrawn-application notice, or `null` when
 * the work item is not withdrawn (the overwhelmingly common case, so the
 * template simply omits the banner).
 *
 * @param {object} [workItem] decorated work item or raw backend DTO
 * @returns {{title: string, text: string, applicationRef: string|null}|null}
 */
export function buildWithdrawnNotice(workItem) {
  if (workItem?.stateId !== WITHDRAWN_STATE_ID) {
    return null
  }

  const applicationRef = readApplicationRef(workItem)

  return {
    title: WITHDRAWN_NOTICE_TITLE,
    text:
      applicationRef === null
        ? WITHDRAWN_TEXT_WITHOUT_REF
        : `Application ${applicationRef} ${WITHDRAWN_TAIL}`,
    applicationRef
  }
}
