import { registerModuleDetailTemplates } from '../core/templates.js'
import { IN_YEAR_CHANGE_CATEGORY } from '../core/categories.js'
import { standardWorkflow } from '../core/standard-workflow.js'
import { buildStandardLifecycleRoutes } from '../core/standard-lifecycle/routes.js'
import { describeCardSite } from '../core/ors-card-site.js'
import { buildAddOverseasSiteSummary } from '#/server/routes/add-overseas-site/application-summary.js'
import { buildAddOverseasSiteHeader } from '#/server/routes/add-overseas-site/case-header.js'
import { isRegistrationOnlyChange } from '#/server/routes/work-items/ors-case-header.js'
import {
  ACCREDITATION_SUMMARY_TAB_KEY,
  APPLICATION_HISTORY_TAB_KEY,
  APPLICATION_SUMMARY_TAB_KEY,
  RELATED_REQUESTS_TAB_KEY
} from '#/server/routes/work-items/case-header.js'

const DETAIL_TEMPLATE_V1 = 'add-overseas-site/detail-v1'

/**
 * RA-739. Add-ORS work item module: an operator's request to add an overseas
 * reprocessing site to an accreditation. Mirrors management-be's
 * `AddOverseasSiteType`: an in-year change following the Standard workflow.
 * management-be splits each submission into one work item per site.
 *
 * The detail page has the add-ORS case header (`buildCaseHeader`) and four
 * tabs (`caseTabs`, RA-495): Application summary, Accreditation summary
 * (RA-769), Related change requests (RA-770) and Application history. The
 * Application summary shows the site from `payload.site`, built by the type's
 * own `buildApplicationSummary`, and the assignment panel.
 *
 * RA-495. The type opts into the shared Standard lifecycle
 * (`standardLifecycle`), using management-be's type-less endpoints: Duly make,
 * Make determination and Confirm applicant contact, with the pending-contact
 * banner and the closed case's Outcome panel from the shared detail template.
 * The Duly make page shows the site's own charge and the related change
 * requests from the same submission. An approval mints nothing: the site
 * joins an accreditation that already exists.
 */
export const addOverseasSiteType = {
  id: 'add-overseas-site',
  displayName: 'New ORS accreditation',
  category: IN_YEAR_CHANGE_CATEGORY,
  // Mirrors `AddOverseasSiteType.TemplateVersion` in management-be, which is
  // the value stamped onto work items. Keep the two in lock-step and add the
  // matching entry to the detail-template map below.
  templateVersion: 'v2',
  initialState: standardWorkflow.initialState,
  states: standardWorkflow.states,
  transitions: standardWorkflow.transitions,
  // Every work item page uses a type's own header and tabs when it has them.
  buildCaseHeader: buildAddOverseasSiteHeader,
  caseTabs: [
    APPLICATION_SUMMARY_TAB_KEY,
    ACCREDITATION_SUMMARY_TAB_KEY,
    RELATED_REQUESTS_TAB_KEY,
    APPLICATION_HISTORY_TAB_KEY
  ],
  // RA-769: a registration-only change has no accreditation to summarise, so
  // its Accreditation summary tab says so without asking the backend.
  hasAccreditation: (payload) => !isRegistrationOnlyChange(payload),
  // The detail controller uses a type's own summary builder when it has one.
  buildApplicationSummary: buildAddOverseasSiteSummary,
  // The Applications list card shows this as its site line, in place of the
  // registration number.
  describeCardSite,
  // The card shows "Submitted on" in every state, not only before assessment.
  cardAlwaysShowsSubmittedOn: true,
  standardLifecycle: {
    // Both live INSIDE `payload`, as the operator backend sends them: the
    // charge is the site's own, the payment reference the whole request's.
    readPaymentDetails: (workItem) => ({
      chargePence: workItem?.payload?.site?.chargePence,
      paymentReference: workItem?.payload?.paymentReference
    }),
    // The Duly make page lists every work item from the same submission.
    relatedWorkItems: true,
    // RA-495 AC6: an approval names the date the site is accredited from.
    effectiveDate: true,
    // Confirming contact adds the site to an existing accreditation (or
    // refuses to); it grants no accreditation, so the default copy is wrong.
    // Provisional copy: not in Figma, pending content design review.
    contactConfirmedBanners: {
      approved: {
        title: 'Applicant contacted',
        text: 'The applicant has been contacted and the overseas reprocessing site has been added to their accreditation.'
      },
      rejected: {
        title: 'Applicant contacted',
        text: 'The applicant has been contacted and the overseas reprocessing site has not been added to their accreditation.'
      }
    }
  }
}

export const addOverseasSiteModule = {
  type: addOverseasSiteType,
  async register(server) {
    // Every version renders with the one template. v2 only made the
    // withdraw transitions non-callable (management-be migrates live items
    // to v2), which this service never offered (RA-317). v1 stays
    // registered so any item still stamped v1 keeps its own template rather
    // than silently falling back to the generic one; the boot-time guard
    // (`assertCurrentTemplateVersionIsRegistered`) needs the current version.
    registerModuleDetailTemplates(addOverseasSiteType.id, {
      v1: DETAIL_TEMPLATE_V1,
      v2: DETAIL_TEMPLATE_V1
    })
    server.route(buildStandardLifecycleRoutes(addOverseasSiteType.id))
  }
}
