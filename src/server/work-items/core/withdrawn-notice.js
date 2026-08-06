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
 * RA-249 rule: the notice may name the case ONLY by its human application
 * reference. It must never fall back to the work-item Guid — the whole point
 * of the ticket is that the system-generated id is not a user-facing
 * identifier. When no reference is available the copy degrades to an
 * unqualified sentence rather than inventing one.
 *
 * ## Why this returns sentence PARTS rather than a finished sentence
 *
 * The template has to wrap the reference in its own element (the e2e suite
 * pins `work-item-withdrawn-reference`), so it cannot simply print one
 * finished string. The first cut of this returned a complete `text` and let
 * the template rebuild the referenced variant by concatenating its own copy
 * around an escaped ref — which meant the tail sentence was written twice
 * (here and in the njk), the referenced `text` was never actually read in
 * production, and correctness depended on a hand-placed `| escape` inside an
 * `html:` sink that bypasses autoescaping.
 *
 * Returning parts fixes all three: the prose exists once, in this file; the
 * template composes it inside a `{% set %}` block capture where
 * `{{ applicationRef }}` goes through normal autoescaping; and there is no
 * `| escape` for a future edit to drop. Note that safety comes from that
 * autoescaping, NOT from the shape of `applicationRef` — this module
 * deliberately does not constrain the reference to an `RA-*` / `AP-*`
 * pattern, because the format is the backend's to decide and has already
 * changed once (RA-318).
 */

export const WITHDRAWN_STATE_ID = 'withdrawn'

export const WITHDRAWN_NOTICE_TITLE = 'This application has been withdrawn'

/**
 * Leading noun phrase when the case can be named by its reference — the
 * reference itself is rendered immediately after it by the template.
 */
export const WITHDRAWN_SUBJECT_WITH_REFERENCE = 'Application'

/** Leading noun phrase when there is no reference to name the case by. */
export const WITHDRAWN_SUBJECT_WITHOUT_REFERENCE = 'This application'

/** The rest of the sentence, identical in both variants. */
export const WITHDRAWN_NOTICE_TAIL =
  'has been withdrawn. It can no longer be progressed and no further action is needed.'

/**
 * Read the human application reference off a work item.
 *
 * `applicationRef` is what the detail controller's `decorate()` produces and
 * is the only path exercised in production — it is always `string | null`
 * there, never `undefined`. The `payload.applicationReference` fallback
 * exists solely so a caller holding a RAW backend DTO (rather than the
 * decorated view model) gets the same answer; it is covered by unit tests
 * but has no production caller today, so do not read it as evidence that
 * undecorated work items flow through here.
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
 * @returns {{
 *   title: string,
 *   subject: string,
 *   applicationRef: string|null,
 *   tail: string
 * }|null}
 */
export function buildWithdrawnNotice(workItem) {
  if (workItem?.stateId !== WITHDRAWN_STATE_ID) {
    return null
  }

  const applicationRef = readApplicationRef(workItem)

  return {
    title: WITHDRAWN_NOTICE_TITLE,
    subject:
      applicationRef === null
        ? WITHDRAWN_SUBJECT_WITHOUT_REFERENCE
        : WITHDRAWN_SUBJECT_WITH_REFERENCE,
    applicationRef,
    tail: WITHDRAWN_NOTICE_TAIL
  }
}
