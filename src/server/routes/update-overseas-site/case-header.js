import {
  assignedToEntry,
  dueOnEntry,
  materialEntry,
  requestTypeEntry,
  statusEntry,
  submittedByEntry,
  submittedOnEntry
} from '#/server/routes/work-items/case-header.js'
import {
  referenceEntry,
  siteTitle
} from '#/server/routes/add-overseas-site/case-header.js'

/**
 * RA-681. The ORS update case header, until the update view has its own
 * design: add-ORS's (the site as the title, no organisation name or Org ID)
 * without the charge and payment date, as an update is not charged
 * (RA-682 AC05). The Application type is the update's own label
 * ("Accreditation: ORS update" / "Registration: ORS update").
 *
 * @param {object} args
 * @param {object} args.header the header fields every type shares
 * @param {object} args.workItem decorated work item
 * @param {object|null} args.assignment assignment view model, when available
 * @returns {object} the `appCaseHeader` macro params
 */
export function buildUpdateOverseasSiteHeader({
  header,
  workItem,
  assignment
}) {
  const payload = workItem?.payload ?? {}
  return {
    ...header,
    title: siteTitle(payload.site),
    meta: [
      requestTypeEntry(workItem),
      statusEntry(workItem),
      assignedToEntry(workItem, assignment),
      dueOnEntry(workItem),
      referenceEntry(payload),
      materialEntry(payload),
      submittedByEntry(payload),
      submittedOnEntry(workItem)
    ]
  }
}
