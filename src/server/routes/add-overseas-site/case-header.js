import { formatChargeAmount } from '#/server/common/helpers/format/charge-amount.js'
import {
  assignedToEntry,
  dueOnEntry,
  formatHeaderDate,
  formatPayment,
  materialEntry,
  statusEntry
} from '#/server/routes/work-items/case-header.js'
import {
  EM_DASH,
  toDisplayLines
} from '#/server/routes/work-items/application-summary.js'

/**
 * RA-739 / RA-495. The add-ORS case header: the reference as a caption above
 * a site title, no organisation name or Org ID, and three rows of four meta
 * items. The fields are RA-495's (the ticket plus Figma "Flows 5"); the
 * caption, title and grid are RA-739's Figma frame (node 854:136663).
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
    caption: header.applicationRef,
    title: siteTitle(payload.site),
    metaLayout: 'in-year-change',
    meta: meta({ workItem, assignment, payload })
  }
}

/** "Site name (ORS id)", as on the in-year change list card. */
function siteTitle(site) {
  const name = site?.siteName || EM_DASH
  return site?.orsId ? `${name} (${site.orsId})` : name
}

/** The first display line of `value`, or the dash. */
function textOrDash(value) {
  return toDisplayLines(value)[0] ?? EM_DASH
}

/**
 * The site's location for the header: its town or city and country
 * ("Copenhagen, Denmark"). The Application summary has the full address.
 */
function siteLocation(site) {
  const parts = [site?.townOrCity, site?.country].flatMap(toDisplayLines)
  return parts.length > 0 ? parts.join(', ') : EM_DASH
}

/**
 * Three rows of four, in the ticket's order (Figma "Flows 5" for the first
 * eight). Status, Assigned to and Due date are built exactly as for
 * re-accreditation. Date added is the work item's submission date. The
 * charge is the site's own (`site.chargePence`), shown whenever it is known
 * (unlike re-accreditation's payment amount, which waits for payment),
 * through the same formatter, always with pence ("£328.00"). The
 * payment date reads "Not received" until the item is duly made, as on
 * re-accreditation. The `request-type` key keeps RA-739's testid.
 */
function meta({ workItem, assignment, payload }) {
  const site = payload.site ?? {}
  return [
    {
      key: 'request-type',
      label: 'Change request type',
      value: workItem.typeDisplayName || EM_DASH
    },
    statusEntry(workItem),
    assignedToEntry(workItem, assignment),
    dueOnEntry(workItem),
    { key: 'location', label: 'Location', value: siteLocation(site) },
    { key: 'site-id', label: 'Site ID', value: textOrDash(site.orsId) },
    {
      key: 'date-added',
      label: 'Date added',
      value: formatHeaderDate(workItem.submittedAt)
    },
    {
      key: 'submitted-by',
      label: 'Submitted by',
      value: textOrDash(payload.submittedBy?.fullName)
    },
    materialEntry(payload),
    {
      key: 'accreditation-number',
      label: 'Accreditation number',
      value: payload.accreditationReference || EM_DASH
    },
    {
      key: 'charge',
      label: 'Charge',
      value: formatChargeAmount(site.chargePence) ?? EM_DASH
    },
    {
      key: 'payment-date',
      label: 'Payment date',
      value: formatPayment(payload).date
    }
  ]
}
