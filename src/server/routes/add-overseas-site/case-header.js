import { buildOrsCaseHeader } from '#/server/routes/work-items/ors-case-header.js'

/**
 * RA-739 / RA-495. The add-ORS case header: the shared ORS case header
 * (`routes/work-items/ors-case-header.js`), a site title, no organisation name
 * or Org ID, and rows of four meta items. The title is RA-739's Figma frame
 * (node 854:136663). That frame's reference caption is left out: the
 * breadcrumb already shows the reference (user, 2026-11-19). No location:
 * the Application summary has it.
 *
 * @param {object} args the `buildCaseHeader` arguments
 * @returns {object} the `appCaseHeader` macro params
 */
export function buildAddOverseasSiteHeader(args) {
  return buildOrsCaseHeader(args)
}
