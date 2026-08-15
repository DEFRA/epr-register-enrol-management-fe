import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { formatSiteAddress } from '#/server/common/helpers/format/site-address.js'
import { buildCaseHeader, buildCaseTabs } from './case-header.js'
import { buildSiteAddressLines } from './application-summary.js'

const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'
const ADDITIONAL_INFORMATION_VIEW = 'work-items/additional-information'

// The only wasteProcessingType value re-ex emits for an exporter — see
// deriveSiteAddress below. Any other value (including absent) takes the
// reprocessor branch.
const EXPORTER_WASTE_PROCESSING_TYPE = 'exporter'

/**
 * RA-434. re-ex's site address exists only for reprocessors
 * (`SiteDto.Address` lives on `ReprocessorRegistrationDto.Site`) — exporters
 * carry none. Mirrors the fallback the OJ frontend's `applicationHeader.js`
 * already applies to its own "Site" header row: the registered address
 * stands in for an exporter's site address, and an absent
 * `wasteProcessingType` (e.g. a work item created manually through CM's
 * "create work item" form) defaults to the reprocessor branch rather than
 * the exporter one.
 *
 * For an exporter this deliberately makes Site address equal Registered
 * address — matches OJ's own header, not a bug.
 */
function deriveSiteAddress(payload, registeredAddress) {
  if (payload.wasteProcessingType === EXPORTER_WASTE_PROCESSING_TYPE) {
    return registeredAddress
  }
  const lines = buildSiteAddressLines(payload)
  return lines.length > 0 ? lines.join(', ') : null
}

/**
 * RA-434. The "Additional information" tab's six-row view model, in the
 * fixed order: Registered name, Companies house number, Registered address,
 * Site name, Site address, Permit numbers.
 *
 * Missing values are OMITTED rather than rendered as a placeholder — the
 * same row-omission behaviour the Application summary tab's reference
 * footer already uses (`buildCaseFooterRows`), so a pre-RA-434 work item
 * with none of these fields simply renders a shorter list.
 *
 * @param {object} args
 * @param {object} args.workItem decorated work item
 * @returns {object[]} ordered `{ key, label, value }` rows
 */
export function buildAdditionalInformationRows({ workItem }) {
  const payload = workItem?.payload ?? {}

  // The full registered address is already computed and single-lined by
  // the operator backend (`AccreditationApplicationModel.CompanyRegisteredAddress`).
  // Run it through `formatSiteAddress` only for the trimming/blank handling
  // that helper already gives the Site address row, for visual consistency
  // between the two.
  const registeredAddress = formatSiteAddress({
    siteAddress: payload.companyRegisteredAddress
  })

  const permitNumbers = Array.isArray(payload.permitNumbers)
    ? payload.permitNumbers.filter(
        (permit) => typeof permit === 'string' && permit.trim() !== ''
      )
    : []

  const candidates = [
    ['organisation-name', 'Registered name', payload.organisationName],
    [
      'companies-house-number',
      'Companies house number',
      payload.companiesHouseNumber
    ],
    ['company-registered-address', 'Registered address', registeredAddress],
    // No producer field exists for a site NAME anywhere in the chain today
    // — always absent, kept here so the row-omission below applies the
    // moment re-ex (or a manual CM work item) can supply one.
    ['site-name', 'Site name', null],
    [
      'site-address',
      'Site address',
      deriveSiteAddress(payload, registeredAddress)
    ],
    [
      'permit-numbers',
      'Permit numbers',
      // Comma-joined on one line, matching the mockup's "[xxxx], [xxxx]" —
      // the fuller permit metadata is not shown, only the numbers.
      permitNumbers.length > 0 ? permitNumbers.join(', ') : null
    ]
  ]

  return candidates
    .filter(([, , value]) => value != null && value !== '')
    .map(([key, label, value]) => ({ key, label, value: String(value) }))
}

/**
 * Render the standalone "Additional information" tab for a work item
 * (RA-434).
 *
 * Mirrors `workItemAuditLogController`: its own bookmarkable page rather
 * than a JS widget, re-fetched via the backend client so the tab always
 * reflects the latest work item.
 */
export const workItemAdditionalInformationController = {
  async handler(request, h) {
    const id = request.params.id
    const user = getUser(request)
    const result = await getWorkItem({ workItemId: id, user })

    if (result.ok === false && result.status === 404) {
      return h
        .view(NOT_FOUND_VIEW, {
          pageTitle: 'Application not found',
          heading: 'Application not found',
          workItemId: id,
          breadcrumbs: [
            { text: 'Applications', href: '/work-items' },
            { text: 'Not found' }
          ]
        })
        .code(404)
    }

    if (!result.ok) {
      return h
        .view(UNAVAILABLE_VIEW, {
          pageTitle: 'Work item unavailable',
          heading: 'Work item unavailable',
          workItemId: id,
          error: result.error ?? `Backend returned ${result.status}`,
          breadcrumbs: [
            { text: 'Work items', href: '/work-items' },
            { text: 'Work item' }
          ]
        })
        .code(502)
    }

    const workItem = result.workItem
    const applicationRef = workItem.payload?.applicationReference
    const type = getWorkItemType(workItem.typeId)
    const stateDisplayName =
      type?.states?.find((s) => s.id === workItem.stateId)?.displayName ??
      workItem.stateId

    return h.view(ADDITIONAL_INFORMATION_VIEW, {
      pageTitle: `Additional information — ${applicationRef}`,
      // RA-295 / RA-434. Same case header and tab strip as the other two
      // tabs.
      caseHeader: buildCaseHeader({
        workItem: {
          ...workItem,
          stateDisplayName,
          stateTagClass: stateTagClass(workItem.stateId)
        }
      }),
      caseTabs: buildCaseTabs({
        workItemId: workItem.id,
        active: 'additional-information'
      }),
      workItem: {
        id: workItem.id,
        applicationRef
      },
      additionalInformationRows: buildAdditionalInformationRows({ workItem })
    })
  }
}
