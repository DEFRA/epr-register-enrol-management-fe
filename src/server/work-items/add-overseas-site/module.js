import { registerModuleDetailTemplates } from '../core/templates.js'
import { IN_YEAR_CHANGE_CATEGORY } from '../core/categories.js'
import { standardWorkflow } from '../core/standard-workflow.js'

/**
 * RA-739. Add-ORS work item module: an operator's request to add an overseas
 * reprocessing site to an accreditation. Mirrors management-be's
 * `AddOverseasSiteType`: an in-year change following the Standard workflow.
 * management-be splits each submission into one work item per site.
 *
 * The detail page is header-only for now; RA-495 adds the request summary,
 * tabs and actions.
 */
export const addOverseasSiteType = {
  id: 'add-overseas-site',
  displayName: 'New ORS accreditation',
  category: IN_YEAR_CHANGE_CATEGORY,
  // Mirrors `AddOverseasSiteType.TemplateVersion` in management-be.
  templateVersion: 'v1',
  initialState: standardWorkflow.initialState,
  states: standardWorkflow.states,
  transitions: standardWorkflow.transitions
}

export const addOverseasSiteModule = {
  type: addOverseasSiteType,
  async register() {
    registerModuleDetailTemplates(addOverseasSiteType.id, {
      v1: 'add-overseas-site/detail-v1'
    })
  }
}
