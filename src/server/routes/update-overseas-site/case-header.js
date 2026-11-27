import { buildAddOverseasSiteHeader } from '#/server/routes/add-overseas-site/case-header.js'
import { EM_DASH } from '#/server/routes/work-items/application-summary.js'

/**
 * RA-782. The ORS update's case header: add-ORS's (site name and ORS id as the
 * title, the same meta items), except that an update is never paid for, so
 * its Payment date is the dash rather than add-ORS's "Not received". The
 * charge shows the site's own, £0.00.
 *
 * @param {object} args the `buildCaseHeader` arguments
 * @returns {object} the `appCaseHeader` macro params
 */
export function buildUpdateOverseasSiteHeader(args) {
  const header = buildAddOverseasSiteHeader(args)
  return {
    ...header,
    meta: header.meta.map((entry) =>
      entry.key === 'payment-date' ? { ...entry, value: EM_DASH } : entry
    )
  }
}
