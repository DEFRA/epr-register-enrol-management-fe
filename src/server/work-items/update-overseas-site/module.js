import { registerModuleDetailTemplates } from '../core/templates.js'
import { IN_YEAR_CHANGE_CATEGORY } from '../core/categories.js'
import { describeOrsCardSite } from '../core/ors-card-site.js'
import { standardWorkflow } from '../core/standard-workflow.js'
import { buildAddOverseasSiteSummary } from '#/server/routes/add-overseas-site/application-summary.js'
import { buildUpdateOverseasSiteHeader } from '#/server/routes/update-overseas-site/case-header.js'
import {
  APPLICATION_HISTORY_TAB_KEY,
  APPLICATION_SUMMARY_TAB_KEY
} from '#/server/routes/work-items/case-header.js'

const DETAIL_TEMPLATE_V1 = 'update-overseas-site/detail-v1'

/**
 * RA-681. The ORS update work item module: an operator's request to change
 * the details of an overseas reprocessing site (RA-682). Mirrors
 * management-be's `UpdateOverseasSiteType`: an in-year change following the
 * Standard workflow, split into one work item per site, with no charge.
 *
 * A minimal module, so the Applications list card and the case header name
 * the request: the full update view (previous and proposed details, the
 * Standard lifecycle, tabs) is the next Case Management service ticket's. Until then the detail
 * page shows the ORS as it stands, with the assignment panel and no actions.
 */
export const updateOverseasSiteType = {
  id: 'update-overseas-site',
  // management-be's `UpdateOverseasSiteType.DisplayName`: the label of an
  // item submitted before the operator backend sent the site's `selected`.
  displayName: 'ORS update',
  // RA-681. "Accreditation:" for an approved ORS, "Registration:" for a
  // registration-only one, from the site's `selected` flag.
  describeRequestType,
  category: IN_YEAR_CHANGE_CATEGORY,
  // Mirrors management-be's `UpdateOverseasSiteType` template version (the
  // `IWorkItemTemplate` default), the value stamped onto work items.
  templateVersion: 'v1',
  initialState: standardWorkflow.initialState,
  states: standardWorkflow.states,
  transitions: standardWorkflow.transitions,
  buildCaseHeader: buildUpdateOverseasSiteHeader,
  caseTabs: [APPLICATION_SUMMARY_TAB_KEY, APPLICATION_HISTORY_TAB_KEY],
  // The ORS as it stands, in add-ORS's site shape.
  buildApplicationSummary: buildAddOverseasSiteSummary,
  // The Applications list card shows this as its site line, in place of the
  // registration number.
  describeCardSite: describeOrsCardSite,
  // The card shows "Submitted on" in every state, as add-ORS's does.
  cardAlwaysShowsSubmittedOn: true
}

/**
 * The request type label for an update's site: null when the site has no
 * boolean `selected`, so the type's `displayName` is the label.
 *
 * @param {object} payload work item payload
 * @returns {string|null}
 */
function describeRequestType(payload) {
  const selected = payload?.site?.selected
  if (selected === true) {
    return 'Accreditation: ORS update'
  }
  if (selected === false) {
    return 'Registration: ORS update'
  }
  return null
}

export const updateOverseasSiteModule = {
  type: updateOverseasSiteType,
  async register() {
    registerModuleDetailTemplates(updateOverseasSiteType.id, {
      v1: DETAIL_TEMPLATE_V1
    })
  }
}
