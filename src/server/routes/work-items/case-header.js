import { formatDateGds } from '#/config/nunjucks/filters/format-date.js'
import { unwrapMongoDate } from '#/server/common/helpers/format/mongo-date.js'
import { materialLabel } from '#/server/work-items/core/materials.js'
// Single definition of the "no value" glyph, shared with the application
// summary rather than redeclared here.
import { EM_DASH } from './application-summary.js'

/**
 * Case header view model (RA-295 AC01).
 *
 * Every individual work item page (the summary tab and the history tab)
 * renders the same full-bleed case header, so the model is built once here
 * and shared. The header carries the eight pieces of information AC01 lists:
 *
 *   1. a back link to the Applications list,
 *   2. the accreditation ref / application ID,
 *   3. the organisation name, and
 *   4. the organisation ID,
 *   5. material,          6. status,
 *   7. assigned to,       8. due on, and 9. registration number.
 *
 * (1)-(4) are the breadcrumb + title lines; the rest are the meta line.
 *
 * The model is intentionally pre-formatted strings only: the macro that
 * renders it stays pure presentation and cannot reach into the payload.
 */

const BACK_HREF = '/work-items'
const BACK_TEXT = 'Applications'
const UNASSIGNED = 'Unassigned'

/**
 * Format the absolute SLA due date for the header.
 *
 * `slaDueDate` is supplied by management-be once the SLA clock has started
 * and is null before then, so an em dash is the correct rendering for a
 * work item whose assessment has not begun. A value we cannot parse also
 * degrades to the em dash rather than throwing out of the template.
 */
export function formatDueOn(value) {
  const iso = unwrapMongoDate(value)
  if (!iso) {
    return EM_DASH
  }
  const formatted = formatDateGds(iso)
  return formatted === '' ? EM_DASH : formatted
}

/**
 * @param {object} args
 * @param {object} args.workItem decorated work item (see detail.controller.js)
 * @param {object} [args.assignment] assignment view model, when available
 * @returns {object} the `appCaseHeader` macro params
 */
export function buildCaseHeader({ workItem, assignment = null }) {
  const payload = workItem?.payload ?? {}

  return {
    backHref: BACK_HREF,
    backText: BACK_TEXT,
    // RA-249. The header's reference line is navigational, so it may fall
    // back to the work item id when the human RA-* reference is absent.
    applicationRef: payload.applicationReference ?? workItem?.id ?? EM_DASH,
    organisationName: payload.organisationName || EM_DASH,
    organisationId: payload.operatorOrganisationId || null,
    meta: [
      {
        key: 'material',
        label: 'Material',
        value: payload.material
          ? materialLabel(payload.material, payload.glassRecyclingProcess)
          : EM_DASH
      },
      {
        key: 'status',
        label: 'Status',
        value: workItem?.stateDisplayName || workItem?.stateId || EM_DASH,
        // RA-324 (AC08). Status keeps the shared state-badge colour so the
        // case header and the Applications list colour a given status
        // identically. `stateTagClass` is set by the detail controller's
        // decorator; when it is absent (a caller that has not decorated the
        // work item) the value simply renders as text.
        tagClass: workItem?.stateTagClass ?? null
      },
      {
        key: 'assigned-to',
        label: 'Assigned to',
        value:
          assignment?.assignedToName ??
          workItem?.assignedToName ??
          workItem?.assignedToId ??
          UNASSIGNED
      },
      {
        key: 'due-on',
        label: 'Due on',
        // RA-359 part 2. A `Cancelled` SLA (terminal/withdrawn item) is a
        // stopped clock: management-be keeps `slaDueDate`, but showing it here
        // would imply a live deadline the caseworker must still meet. Suppress
        // it to the em dash, matching a work item whose clock never started.
        // OnTrack/AtRisk/Breached keep the date.
        value:
          workItem?.slaState === 'Cancelled'
            ? EM_DASH
            : formatDueOn(workItem?.slaDueDate)
      },
      {
        key: 'registration-number',
        label: 'Registration number',
        value: payload.registrationNumber || EM_DASH
      }
    ]
  }
}

/**
 * The four tabs every individual work item page carries (RA-295, RA-434,
 * RA-469). "Application summary" is the detail page itself; "Recycling
 * operations" (RA-469) lists each overseas reprocessing site's recycling
 * operation codes; "Application history" is the audit log page;
 * "Additional information" (RA-434) is the six-field summary list re-ex/CM
 * data that has nowhere else to live.
 *
 * RA-469 deliberately positions "Recycling operations" SECOND — immediately
 * after "Application summary" — even though the ticket's own text was
 * written when only two tabs existed and described it as sitting "between
 * Application summary and Application history". "Application history" and
 * "Additional information" both keep their existing order relative to each
 * other; only the new tab is inserted.
 *
 * @param {object} args
 * @param {string} args.workItemId
 * @param {'summary'|'recycling-operations'|'history'|'additional-information'} args.active
 */
export function buildCaseTabs({ workItemId, active }) {
  const base = `/work-items/${encodeURIComponent(workItemId)}`
  return [
    {
      key: 'application-summary',
      text: 'Application summary',
      href: base,
      active: active === 'summary'
    },
    {
      key: 'recycling-operations',
      text: 'Recycling operations',
      href: `${base}/recycling-operations`,
      active: active === 'recycling-operations'
    },
    {
      key: 'application-history',
      text: 'Application history',
      href: `${base}/audit-log`,
      active: active === 'history'
    },
    {
      key: 'additional-information',
      text: 'Additional information',
      href: `${base}/additional-information`,
      active: active === 'additional-information'
    }
  ]
}
