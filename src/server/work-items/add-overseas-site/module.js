import { registerModuleDetailTemplates } from '../core/templates.js'
import { IN_YEAR_CHANGE_CATEGORY } from '../core/categories.js'
import { standardWorkflow } from '../core/standard-workflow.js'
import { buildAddOverseasSiteSummary } from '#/server/routes/add-overseas-site/application-summary.js'
import { buildAddOverseasSiteHeader } from '#/server/routes/add-overseas-site/case-header.js'
import {
  APPLICATION_HISTORY_TAB_KEY,
  APPLICATION_SUMMARY_TAB_KEY
} from '#/server/routes/work-items/case-header.js'

/**
 * RA-739. Add-ORS work item module: an operator's request to add an overseas
 * reprocessing site to an accreditation. Mirrors management-be's
 * `AddOverseasSiteType`: an in-year change following the Standard workflow.
 * management-be splits each submission into one work item per site.
 *
 * The detail page has the add-ORS case header (`buildCaseHeader`) and only
 * the Application summary and Application history tabs (`caseTabs`); later
 * tickets add Accreditation summary and Related applications. The Application summary shows the site from
 * `payload.site`, built by the type's own `buildApplicationSummary`, and the
 * assignment panel; RA-495 adds the actions.
 */
export const addOverseasSiteType = {
  id: 'add-overseas-site',
  displayName: 'New ORS accreditation',
  category: IN_YEAR_CHANGE_CATEGORY,
  // Mirrors `AddOverseasSiteType.TemplateVersion` in management-be.
  templateVersion: 'v1',
  initialState: standardWorkflow.initialState,
  states: standardWorkflow.states,
  transitions: standardWorkflow.transitions,
  // Every work item page uses a type's own header and tabs when it has them.
  buildCaseHeader: buildAddOverseasSiteHeader,
  caseTabs: [APPLICATION_SUMMARY_TAB_KEY, APPLICATION_HISTORY_TAB_KEY],
  // The detail controller uses a type's own summary builder when it has one.
  buildApplicationSummary: buildAddOverseasSiteSummary,
  // The Applications list card shows this as its site line, in place of the
  // registration number.
  describeCardSite,
  // The card shows "Submitted on" in every state, not only before assessment.
  cardAlwaysShowsSubmittedOn: true
}

/**
 * The in-year change card's site line: the site's name and its ORS id, from
 * the one site management-be stamps on each add-ORS work item.
 *
 * @param {object} payload work item payload
 * @returns {{ name: string|null, reference: string|null }}
 */
function describeCardSite(payload) {
  const site = payload?.site ?? {}
  return { name: site.siteName ?? null, reference: site.orsId ?? null }
}

export const addOverseasSiteModule = {
  type: addOverseasSiteType,
  async register() {
    registerModuleDetailTemplates(addOverseasSiteType.id, {
      v1: 'add-overseas-site/detail-v1'
    })
  }
}
