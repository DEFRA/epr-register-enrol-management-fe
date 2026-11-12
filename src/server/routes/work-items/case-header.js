import { formatDateShortGds } from '#/config/nunjucks/filters/format-date.js'
import { formatChargeAmount } from '#/server/common/helpers/format/charge-amount.js'
import { unwrapMongoDate } from '#/server/common/helpers/format/mongo-date.js'
import { materialLabel } from '#/server/work-items/core/materials.js'
import { isInYearChangeType } from '#/server/work-items/core/categories.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
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
 *   7. assigned to,       8. due on, and 9. registration number,
 *
 * plus (RA-493) 10. payment date and 11. payment amount.
 *
 * (1)-(4) are the breadcrumb + title lines; the rest are the meta line.
 *
 * RA-739. An in-year change (add-ORS) header instead has an optional
 * `caption` (the reference) above its own `title` (the site), no
 * organisation, and its own meta: see `inYearChangeMeta`.
 *
 * The model is intentionally pre-formatted strings only: the macro that
 * renders it stays pure presentation and cannot reach into the payload.
 */

const BACK_HREF = '/work-items'
const BACK_TEXT = 'Applications'
const UNASSIGNED = 'Unassigned'
export const NOT_RECEIVED = 'Not received'

/**
 * Duly Made payment information for the header (RA-493).
 *
 * management-be stamps `payload.paymentDate` (a `yyyy-MM-dd` DateOnly)
 * when the work item is marked Duly made, and it is null before then. A
 * recorded payment date is therefore the signal that payment has been
 * received: until it is present (or if it cannot be parsed) BOTH the date
 * and the amount read "Not received" (AC04), even when the charge itself
 * is already known from submission.
 *
 * Once duly made, the amount is the charge currently recorded against the
 * application (AC03). `0` is a legitimate charge and formats as "£0"; an
 * absent or malformed charge degrades to the em dash rather than claiming
 * payment was not received.
 *
 * @returns {{ date: string, amount: string }}
 */
export function formatPayment(payload) {
  const iso = unwrapMongoDate(payload?.paymentDate)
  const date = iso ? formatDateShortGds(iso) : ''
  if (date === '') {
    return { date: NOT_RECEIVED, amount: NOT_RECEIVED }
  }
  return {
    date,
    amount: formatChargeAmount(payload.chargeAmountPence) ?? EM_DASH
  }
}

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
  const formatted = formatDateShortGds(iso)
  return formatted === '' ? EM_DASH : formatted
}

// RA-503: operatorOrganisationId means two different things depending on how the work item was
// created. Real operator submissions (epr-register-enrol-backend's HttpCaseWorkingApiAdapter)
// send ReEx's internal Mongo ObjectId — never safe to show an operator or regulator. The
// case-management admin "create work item" form (re-accreditation/create/schema.js) instead
// validates it as a genuine 6-digit organisation number before submission (RA-448), so for THOSE
// items it's already the correct value. A 24-char hex ObjectId can never match this pattern, so
// shape alone tells the two apart.
const SIX_DIGIT_ORG_NUMBER = /^\d{6}$/

/**
 * Resolve the operator/regulator-safe organisation id to display in the case header.
 *
 * Prefers `operatorOrgNumber` (the numeric value HttpCaseWorkingApiAdapter now sends for real
 * operator submissions). Falls back to `operatorOrganisationId` only when it is itself
 * genuinely 6-digit numeric — i.e. an admin-created work item, not ReEx's ObjectId — so this
 * never reintroduces the ObjectId leak RA-503 fixes.
 */
export function resolveOrganisationId(payload) {
  if (
    payload.operatorOrgNumber !== undefined &&
    payload.operatorOrgNumber !== null
  ) {
    return payload.operatorOrgNumber
  }
  const organisationId = payload.operatorOrganisationId
  return typeof organisationId === 'string' &&
    SIX_DIGIT_ORG_NUMBER.test(organisationId)
    ? organisationId
    : null
}

/**
 * @param {object} args
 * @param {object} args.workItem decorated work item (see detail.controller.js)
 * @param {object} [args.assignment] assignment view model, when available
 * @returns {object} the `appCaseHeader` macro params
 */
export function buildCaseHeader({ workItem, assignment = null }) {
  const payload = workItem?.payload ?? {}
  const header = {
    backHref: BACK_HREF,
    backText: BACK_TEXT,
    // RA-249. The header's reference line is navigational, so it may fall
    // back to the work item id when the human RA-* reference is absent.
    applicationRef: payload.applicationReference ?? workItem?.id ?? EM_DASH
  }

  // RA-739. An in-year change (add-ORS) header follows its own Figma frame
  // (node 854:136663): the reference as a caption above a site title, no
  // organisation name or Org ID, and two rows of four meta items.
  if (isInYearChangeType({ category: workItem?.typeCategory })) {
    return {
      ...header,
      caption: header.applicationRef,
      title: siteTitle(payload.site),
      metaLayout: 'in-year-change',
      meta: inYearChangeMeta({ workItem, assignment, payload })
    }
  }

  return {
    ...header,
    organisationName: payload.organisationName || EM_DASH,
    organisationId: resolveOrganisationId(payload),
    meta: reAccreditationMeta({ workItem, assignment, payload })
  }
}

/** "Site name (ORS id)", as on the in-year change list card. */
function siteTitle(site) {
  const name = site?.siteName || EM_DASH
  return site?.orsId ? `${name} (${site.orsId})` : name
}

function materialEntry(payload) {
  return {
    key: 'material',
    label: 'Material',
    value: payload.material
      ? materialLabel(payload.material, payload.glassRecyclingProcess)
      : EM_DASH
  }
}

function statusEntry(workItem) {
  return {
    key: 'status',
    label: 'Status',
    value: workItem?.stateDisplayName || workItem?.stateId || EM_DASH,
    // RA-324 (AC08). Status keeps the shared state-badge colour so the
    // case header and the Applications list colour a given status
    // identically. `stateTagClass` is set by `decorateForCaseHeader` (or
    // the detail controller's decorator); when it is absent (a caller that
    // has not decorated the work item) the value simply renders as text.
    tagClass: workItem?.stateTagClass ?? null
  }
}

function assignedToEntry(workItem, assignment) {
  return {
    key: 'assigned-to',
    label: 'Assigned to',
    value:
      assignment?.assignedToName ??
      workItem?.assignedToName ??
      workItem?.assignedToId ??
      UNASSIGNED
  }
}

function dueOnEntry(workItem) {
  return {
    key: 'due-on',
    label: 'Due date',
    // RA-359 part 2. A `Cancelled` SLA (terminal/withdrawn item) is a
    // stopped clock: management-be keeps `slaDueDate`, but showing it here
    // would imply a live deadline the caseworker must still meet. Suppress
    // it to the em dash, matching a work item whose clock never started.
    // OnTrack/AtRisk/Breached keep the date.
    value:
      workItem?.slaState === 'Cancelled'
        ? EM_DASH
        : formatDueOn(workItem?.slaDueDate)
  }
}

function reAccreditationMeta({ workItem, assignment, payload }) {
  const payment = formatPayment(payload)
  return [
    materialEntry(payload),
    statusEntry(workItem),
    assignedToEntry(workItem, assignment),
    dueOnEntry(workItem),
    {
      key: 'registration-number',
      label: 'Registration number',
      value: payload.registrationNumber || EM_DASH
    },
    // RA-493. Figma places "Payment date" after "Registration number"
    // (second row under "Status"); the meta line is an inline flex-wrap,
    // so sequence alone controls placement. Figma omits the amount, but
    // AC02/AC04 require it, so it sits immediately after the date.
    {
      key: 'payment-date',
      label: 'Payment date',
      value: payment.date
    },
    {
      key: 'payment-amount',
      label: 'Payment amount',
      value: payment.amount
    }
  ]
}

/**
 * RA-739. The add-ORS meta, two rows of four in Figma order. Status,
 * Assigned to and Due date are built exactly as for re-accreditation. The
 * charge is the site's own (`site.chargePence`), shown whenever it is known
 * (unlike re-accreditation's payment amount, which waits for payment),
 * through the same formatter: whole pounds without pence ("£328").
 */
function inYearChangeMeta({ workItem, assignment, payload }) {
  return [
    {
      key: 'request-type',
      label: 'Request type',
      value: workItem.typeDisplayName || EM_DASH
    },
    statusEntry(workItem),
    assignedToEntry(workItem, assignment),
    dueOnEntry(workItem),
    materialEntry(payload),
    {
      key: 'accreditation-number',
      label: 'Accreditation number',
      value: payload.accreditationReference || EM_DASH
    },
    {
      key: 'charge',
      label: 'Charge',
      value: formatChargeAmount(payload.site?.chargePence) ?? EM_DASH
    },
    {
      key: 'payment-date',
      label: 'Payment date',
      value: formatPayment(payload).date
    }
  ]
}

/**
 * Decorate a raw work item with the fields the case header and tabs read:
 * its type's display name and category, and its state's display name and
 * badge colour. Every work item page builds its header from a work item
 * decorated this way, so a case type gets its own header on every tab
 * (RA-739). The detail page's own decorator sets the same fields.
 *
 * @param {object} workItem raw work item from management-be
 * @returns {object}
 */
export function decorateForCaseHeader(workItem) {
  const type = getWorkItemType(workItem.typeId)
  return {
    ...workItem,
    typeDisplayName: type?.displayName ?? workItem.typeId,
    typeCategory: type?.category ?? null,
    stateDisplayName:
      type?.states?.find((state) => state.id === workItem.stateId)
        ?.displayName ?? workItem.stateId,
    stateTagClass: stateTagClass(workItem.stateId)
  }
}

// Single source of truth for the tab's key (SonarCloud S1192 — the string
// was repeated three times across the tab definition, the active check, and
// the filter below).
const RECYCLING_OPERATIONS_TAB_KEY = 'recycling-operations'
const APPLICATION_SUMMARY_TAB_KEY = 'application-summary'
const APPLICATION_HISTORY_TAB_KEY = 'application-history'

// RA-469 follow-up. Product asked for the "Recycling operations" tab to be
// hidden for now — the copy may be reworded before it's shown again. This
// only suppresses its entry in the tab bar below (via the filter in
// buildCaseTabs); the route, controller, and page it points to are
// untouched and still work for anyone who has the URL. Remove the key (or
// empty the set) once product confirms the tab is ready to show again.
//
// Deliberately a set of hidden keys, not a boolean "hide" flag on a shared
// function — SonarCloud's S2301 flags the latter ("provide multiple
// methods instead of using a flag to determine which action to take"), and
// a data-driven filter has no dead branch to leave uncovered in the first
// place: the same tabs.filter() call below exercises both the "excluded"
// and "included" outcomes across the four tabs in every existing test.
const HIDDEN_TAB_KEYS = new Set([RECYCLING_OPERATIONS_TAB_KEY])

// RA-739. The tabs an in-year change (add-ORS) shows. Later tickets add the
// Accreditation summary and Related applications tabs here.
const IN_YEAR_CHANGE_TAB_KEYS = new Set([
  APPLICATION_SUMMARY_TAB_KEY,
  APPLICATION_HISTORY_TAB_KEY
])

/**
 * The four tabs every individual work item page carries (RA-295, RA-434,
 * RA-469). "Application summary" is the detail page itself; "Recycling
 * operations" (RA-469) lists each overseas reprocessing site's recycling
 * operation codes — currently hidden, see HIDDEN_TAB_KEYS above;
 * "Application history" is the audit log page; "Additional
 * information" (RA-434) is the six-field summary list re-ex/Case Management
 * service data that has nowhere else to live.
 *
 * RA-469 deliberately positions "Recycling operations" SECOND — immediately
 * after "Application summary" — even though the ticket's own text was
 * written when only two tabs existed and described it as sitting "between
 * Application summary and Application history". "Application history" and
 * "Additional information" both keep their existing order relative to each
 * other; only the new tab is inserted.
 *
 * RA-739. An in-year change (add-ORS) has only Application summary and
 * Application history; the tabs depend on the work item type's category.
 *
 * @param {object} args
 * @param {string} args.workItemId
 * @param {'summary'|'recycling-operations'|'history'|'additional-information'} args.active
 * @param {string|null} [args.category] the work item type's category
 */
export function buildCaseTabs({ workItemId, active, category = null }) {
  const base = `/work-items/${encodeURIComponent(workItemId)}`
  const tabs = [
    {
      key: APPLICATION_SUMMARY_TAB_KEY,
      text: 'Application summary',
      href: base,
      active: active === 'summary'
    },
    {
      key: RECYCLING_OPERATIONS_TAB_KEY,
      text: 'Recycling operations',
      href: `${base}/recycling-operations`,
      active: active === RECYCLING_OPERATIONS_TAB_KEY
    },
    {
      key: APPLICATION_HISTORY_TAB_KEY,
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
  const isVisible = isInYearChangeType({ category })
    ? (tab) => IN_YEAR_CHANGE_TAB_KEYS.has(tab.key)
    : (tab) => !HIDDEN_TAB_KEYS.has(tab.key)
  return tabs.filter(isVisible)
}
