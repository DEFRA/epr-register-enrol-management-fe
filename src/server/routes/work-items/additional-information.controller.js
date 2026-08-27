import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { formatSiteAddress } from '#/server/common/helpers/format/site-address.js'
import { buildCaseHeader, buildCaseTabs } from './case-header.js'
import { deriveSiteAddress } from './application-summary.js'
import { renderWorkItemFetchError } from './work-item-fetch-errors.js'

const ADDITIONAL_INFORMATION_VIEW = 'work-items/additional-information'

/**
 * RA-434 / RA-480. The "Additional information" tab's row view model, in the
 * fixed order: Registered name, Companies house number, Registered address,
 * Site name, Site address, Permit numbers, Contact full name, Contact email,
 * Contact phone, Contact job title.
 *
 * Missing values are OMITTED rather than rendered as a placeholder, so a
 * pre-RA-434 work item with none of these fields simply renders a shorter
 * list.
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
    ? payload.permitNumbers
        .filter((permit) => typeof permit === 'string')
        .map((permit) => permit.trim())
        .filter((permit) => permit !== '')
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
    // moment re-ex (or a manual Case Management service work item) can
    // supply one.
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
    ],
    [
      'contact-full-name',
      'Contact full name',
      payload.submitterContactDetails?.fullName
    ],
    ['contact-email', 'Contact email', payload.submitterContactDetails?.email],
    ['contact-phone', 'Contact phone', payload.submitterContactDetails?.phone],
    [
      'contact-job-title',
      'Contact job title',
      payload.submitterContactDetails?.jobTitle
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

    const errorResponse = renderWorkItemFetchError({ h, result, id })
    if (errorResponse) {
      return errorResponse
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
