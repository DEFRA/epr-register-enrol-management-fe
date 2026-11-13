import { formatChargeAmount } from '#/server/common/helpers/format/charge-amount.js'
import {
  assignedToEntry,
  dueOnEntry,
  formatPayment,
  materialEntry,
  statusEntry
} from '#/server/routes/work-items/case-header.js'
import { EM_DASH } from '#/server/routes/work-items/application-summary.js'

/**
 * RA-739. The add-ORS case header, from its own Figma frame (node
 * 854:136663): the reference as a caption above a site title, no
 * organisation name or Org ID, and two rows of four meta items.
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

/**
 * Two rows of four in Figma order. Status, Assigned to and Due date are
 * built exactly as for re-accreditation. The charge is the site's own
 * (`site.chargePence`), shown whenever it is known (unlike re-accreditation's
 * payment amount, which waits for payment), through the same formatter:
 * whole pounds without pence ("£328").
 */
function meta({ workItem, assignment, payload }) {
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
