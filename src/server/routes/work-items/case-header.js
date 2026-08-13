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
  if (!iso) return EM_DASH
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
        value: formatDueOn(workItem?.slaDueDate)
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
 * The two tabs every individual work item page carries (RA-295).
 * "Application summary" is the detail page itself; "Application history" is
 * the audit log page, which is the natural home for the case timeline.
 *
 * @param {object} args
 * @param {string} args.workItemId
 * @param {'summary'|'history'} args.active
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
      key: 'application-history',
      text: 'Application history',
      href: `${base}/audit-log`,
      active: active === 'history'
    }
  ]
}
