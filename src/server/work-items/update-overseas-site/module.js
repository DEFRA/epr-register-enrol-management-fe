import { registerModuleDetailTemplates } from '../core/templates.js'
import { IN_YEAR_CHANGE_CATEGORY } from '../core/categories.js'
import { standardWorkflow } from '../core/standard-workflow.js'
import { buildStandardLifecycleRoutes } from '../core/standard-lifecycle/routes.js'
import { buildUpdateOverseasSiteSummary } from '#/server/routes/update-overseas-site/application-summary.js'
import { buildUpdateOverseasSiteHeader } from '#/server/routes/update-overseas-site/case-header.js'
import { describeCardSite } from '../core/ors-card-site.js'
import {
  ACCREDITATION_SUMMARY_TAB_KEY,
  APPLICATION_HISTORY_TAB_KEY,
  APPLICATION_SUMMARY_TAB_KEY,
  RELATED_REQUESTS_TAB_KEY
} from '#/server/routes/work-items/case-header.js'

const DETAIL_TEMPLATE_V1 = 'update-overseas-site/detail-v1'

/**
 * RA-767 / RA-782. ORS update work item module: an operator's request to
 * change the details of an overseas reprocessing site already on their
 * accreditation, including its interim sites. Mirrors management-be's
 * `UpdateOverseasSiteType` (RA-682): an in-year change on the Standard
 * workflow, one work item per site, never charged.
 *
 * Its card, header and tabs are add-ORS's: the card's site line is the site
 * name and ORS id, the header has the add-ORS layout (plus the application reference and
 * the site's location, and "-" for the charge and payment date),
 * and the tabs are Application summary, Accreditation summary, Related change
 * requests and Application history. The Application summary compares the
 * ORS's current details with the requested ones (`buildApplicationSummary`).
 *
 * It opts into the shared Standard lifecycle with management-be's type-less
 * endpoints. Unlike add-ORS: no payment date at Duly make (nothing is paid,
 * and management-be refuses one), and no valid from date at determination
 * (a change to an ORS changes neither its status nor when it was accredited
 * from; user, 2026-11-27).
 */
export const updateOverseasSiteType = {
  id: 'update-overseas-site',
  // RA-767's case-type table (user, 2026-11-27).
  displayName: 'Update ORS Accreditation',
  category: IN_YEAR_CHANGE_CATEGORY,
  // management-be's `UpdateOverseasSiteType` keeps the default template
  // version. Keep the two in lock-step.
  templateVersion: 'v1',
  initialState: standardWorkflow.initialState,
  states: standardWorkflow.states,
  transitions: standardWorkflow.transitions,
  buildCaseHeader: buildUpdateOverseasSiteHeader,
  caseTabs: [
    APPLICATION_SUMMARY_TAB_KEY,
    ACCREDITATION_SUMMARY_TAB_KEY,
    RELATED_REQUESTS_TAB_KEY,
    APPLICATION_HISTORY_TAB_KEY
  ],
  // An update is to an ORS already on an accreditation, so there is always
  // one to summarise.
  hasAccreditation: () => true,
  buildApplicationSummary: buildUpdateOverseasSiteSummary,
  describeCardSite,
  cardAlwaysShowsSubmittedOn: true,
  standardLifecycle: {
    // The Duly make page lists every work item from the same submission.
    relatedWorkItems: true,
    // No valid from date: the ORS keeps the date it was accredited from.
    effectiveDate: false,
    // RA-782 AC4 / RA-682 AC05: nothing is paid, so Duly make asks for no
    // payment date and shows the charge and payment reference as "-", with
    // no payment details to read (no `readPaymentDetails`). management-be's
    // own `takesPaymentDate` decides when the page can read it; this is the
    // fallback.
    paymentDate: false,
    // Provisional copy: not in the design, pending content design review.
    contactConfirmedBanners: {
      approved: {
        title: 'Applicant contacted',
        text: "The applicant has been contacted and the overseas reprocessing site's details have been updated on their accreditation."
      },
      rejected: {
        title: 'Applicant contacted',
        text: "The applicant has been contacted and the overseas reprocessing site's details stay as they were."
      }
    }
  }
}

export const updateOverseasSiteModule = {
  type: updateOverseasSiteType,
  async register(server) {
    registerModuleDetailTemplates(updateOverseasSiteType.id, {
      v1: DETAIL_TEMPLATE_V1
    })
    server.route(buildStandardLifecycleRoutes(updateOverseasSiteType.id))
  }
}
