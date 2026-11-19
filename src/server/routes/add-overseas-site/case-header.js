import {
  assignedToEntry,
  chargeEntry,
  dueOnEntry,
  effectiveDateEntry,
  materialEntry,
  paymentDateEntry,
  requestTypeEntry,
  statusEntry,
  submittedByEntry,
  submittedOnEntry
} from '#/server/routes/work-items/case-header.js'
import { EM_DASH } from '#/server/routes/work-items/application-summary.js'

/**
 * RA-739 / RA-495. The add-ORS case header: a site title, no organisation
 * name or Org ID, and rows of four meta items. The title is RA-739's Figma
 * frame (node 854:136663). That frame's reference caption is left out: the
 * breadcrumb already shows the reference (user, 2026-11-19).
 *
 * @param {object} args
 * @param {object} args.header the header fields every type shares
 * @param {object} args.workItem decorated work item
 * @param {object|null} args.assignment assignment view model, when available
 * @returns {object} the `appCaseHeader` macro params
 */
export function buildAddOverseasSiteHeader({ header, workItem, assignment }) {
  const payload = workItem?.payload ?? {}
  return {
    ...header,
    title: siteTitle(payload.site),
    meta: meta({ workItem, assignment, payload })
  }
}

/** "Site name (ORS id)", as on the in-year change list card. */
function siteTitle(site) {
  const name = site?.siteName || EM_DASH
  return site?.orsId ? `${name} (${site.orsId})` : name
}

/**
 * The same fields in the same places as re-accreditation's (user,
 * 2026-11-19), with the accreditation number where it has the registration
 * number. No Site ID (the title has the ORS id) or location (the Application
 * summary has it).
 *
 * The charge is the site's own (`site.chargePence`), always with pence
 * ("£328.00"). RA-495 AC6: Effective date is the dash until the
 * determination records one (`payload.effectiveDate`: the date entered on
 * approval, the submission date on refusal).
 */
function meta({ workItem, assignment, payload }) {
  return [
    requestTypeEntry(workItem),
    statusEntry(workItem),
    assignedToEntry(workItem, assignment),
    dueOnEntry(workItem),
    {
      key: 'accreditation-number',
      label: 'Accreditation number',
      value: payload.accreditationReference || EM_DASH
    },
    materialEntry(payload),
    submittedByEntry(payload),
    submittedOnEntry(workItem),
    chargeEntry(payload.site?.chargePence),
    paymentDateEntry(payload),
    effectiveDateEntry(payload.effectiveDate)
  ]
}
