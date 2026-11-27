import { buildOrsCaseHeader } from '#/server/routes/work-items/ors-case-header.js'

/**
 * RA-782. The ORS update's case header: the shared ORS case header (site name
 * and ORS id as the title, add-ORS's meta items) with, for AC1, the
 * application reference above the title and the site's location after its
 * accreditation number. An update is never paid for, so its charge and
 * payment date read "-" (AC4), as on its Duly make page.
 *
 * @param {object} args the `buildCaseHeader` arguments
 * @returns {object} the `appCaseHeader` macro params
 */
export function buildUpdateOverseasSiteHeader(args) {
  return buildOrsCaseHeader(args, {
    withReferenceAndLocation: true,
    charged: false
  })
}
