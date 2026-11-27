import { formatDateShortGds } from '#/config/nunjucks/filters/format-date.js'
import { formatHeaderDate } from '#/server/routes/work-items/case-header.js'
import {
  STATE_APPROVED,
  STATE_APPROVED_PENDING_CONTACT
} from '#/server/work-items/core/standard-workflow.js'
import {
  EM_DASH,
  buildInterimSites,
  fileViewModel,
  interimSiteAddressLines,
  overseasSiteAddressLines,
  toDisplayLines
} from '#/server/routes/work-items/application-summary.js'

/**
 * RA-739. The add-ORS Application summary, from the Figma "Application page -
 * Summary" frame: the site being added (`payload.site`, in re-accreditation's
 * overseas site shape) and its interim sites.
 *
 * Every row always renders, so a missing value shows the dash rather than a
 * gap. EU and OECD are not shown (the design has no rows for them).
 *
 * RA-495. A row is `supplied` when the operator gave its value on this
 * request rather than it coming from the site's registration: the operator
 * backend lists those fields in `site.suppliedFields`, named as in
 * `SITE_FIELDS`, and `besEvidence` when the operator uploaded the BES
 * evidence files on the request (3bb.13). The operator can only fill a field
 * the ORS lacks and add BES evidence, so those markers are the whole change:
 * there is no "Previous details" section, as an update would have.
 *
 * @param {object} args
 * @param {object} args.workItem decorated work item
 * @returns {{ validFrom: object | null, rows: object[], interimSites: object[] }}
 */
export function buildAddOverseasSiteSummary({ workItem }) {
  const site = workItem?.payload?.site ?? {}
  const workItemId = workItem?.id ?? ''
  const supplied = new Set(
    Array.isArray(site.suppliedFields) ? site.suppliedFields : []
  )

  return {
    validFrom: validFromEntry(workItem),
    rows: siteRows(site, workItemId, supplied),
    interimSites: withShortAddressOnlyForRepeatedNames(
      buildInterimSites(site, buildAddOrsInterimSite)
    )
  }
}

// "Approved" (awaiting the applicant contact) and "Granted".
const APPROVED_STATE_IDS = new Set([
  STATE_APPROVED_PENDING_CONTACT,
  STATE_APPROVED
])

/**
 * The Valid from date: the
 * date the determination recorded (`payload.effectiveDate`, RA-495 AC6), shown
 * above the site's rows. Only an approved or granted case has one to show: a
 * refusal records the submission date there (so management-be can close the
 * case), and nothing takes effect. Absent until there is a date.
 *
 * @returns {{ key: string, label: string, value: string } | null}
 */
function validFromEntry(workItem) {
  if (!APPROVED_STATE_IDS.has(workItem?.stateId)) {
    return null
  }
  const value = formatHeaderDate(workItem?.payload?.effectiveDate)
  return value === EM_DASH
    ? null
    : { key: 'valid-from', label: 'Valid from date', value }
}

/**
 * As re-accreditation's overseas sites: the collapsed heading shows the short
 * address only to tell apart interim sites that share a name.
 */
function withShortAddressOnlyForRepeatedNames(interimSites) {
  const nameCounts = new Map()
  for (const { siteName } of interimSites) {
    nameCounts.set(siteName, (nameCounts.get(siteName) ?? 0) + 1)
  }
  return interimSites.map((interimSite) =>
    nameCounts.get(interimSite.siteName) > 1
      ? interimSite
      : { ...interimSite, shortAddress: '' }
  )
}

function siteRows(site, workItemId, supplied) {
  return [
    ...SITE_FIELDS.map(([key, label, read, suppliedField]) => {
      const lines = read(site)
      return {
        key,
        label,
        kind: 'lines',
        values: orDash(lines),
        supplied: lines.length > 0 && supplied.has(suppliedField)
      }
    }),
    besEvidenceRow(site, workItemId, supplied.has(BES_EVIDENCE_FIELD))
  ]
}

/** One comma-separated line, or nothing when there are no parts. */
export function joined(lines) {
  return lines.length > 0 ? [lines.join(', ')] : []
}

export function orDash(lines) {
  return lines.length > 0 ? lines : [EM_DASH]
}

/**
 * Figma's labels and order. Keys form the `app-detail-*` testids. The fourth
 * entry, where there is one, is the operator backend's name for the field
 * when the operator supplied it (`ChangeRequestRules`: the four fields an
 * ORS may lack and the operator then answers on the request). The location
 * row is marked when the operator supplied the country.
 *
 * RA-782: exported for the ORS update summary, which shows the same rows.
 */
export const SITE_FIELDS = [
  ['site-name', 'Site name', (site) => toDisplayLines(site.siteName)],
  [
    'location',
    'Location',
    (site) => joined(overseasSiteAddressLines(site, false)),
    'country'
  ],
  // Not in the Figma frame: re-accreditation's site view wording and order.
  ['ors-id', 'ORS ID', (site) => toDisplayLines(site.orsId)],
  [
    'coordinates',
    'Coordinates',
    (site) => toDisplayLines(site.coordinates),
    'coordinates'
  ],
  ['contact-name', 'Contact name', (site) => toDisplayLines(site.contactName)],
  [
    'contact-email',
    'Contact email',
    (site) => toDisplayLines(site.contactEmail)
  ],
  [
    'contact-phone',
    'Contact phone number',
    (site) => toDisplayLines(site.contactPhone)
  ],
  // Re-accreditation's labels for these two.
  [
    'recycling-operation',
    'Operation code',
    (site) => joined(toDisplayLines(site.operationCodes)),
    'operationCodes'
  ],
  [
    'basel-codes',
    'Basel/OECD codes',
    (site) =>
      joined([site.code1, site.code2, site.code3].flatMap(toDisplayLines))
  ],
  [
    'repatriated-loads',
    'Arrangements for rejected or returned loads',
    (site) => toDisplayLines(site.repatriatedLoads)
  ],
  [
    'conditions-of-export',
    'Conditions of export',
    (site) => toDisplayLines(site.conditionsOfExport),
    'conditionsOfExport'
  ]
]

/** 3bb.13: the operator backend's name for BES evidence uploaded on the request. */
const BES_EVIDENCE_FIELD = 'besEvidence'

function besEvidenceRow(site, workItemId, isSupplied) {
  const files = besFilesOf(site).map((file) =>
    besFileViewModel(file, workItemId)
  )
  return {
    key: 'bes-evidence',
    label: 'Evidence of broadly equivalent standards',
    kind: 'files',
    files,
    supplied: files.length > 0 && isSupplied
  }
}

function besFilesOf(site) {
  const files = site.besEvidence?.files
  return Array.isArray(files) ? files : []
}

/** The shared file view model (Clean-only link), plus the BES dates. */
export function besFileViewModel(file, workItemId) {
  return {
    ...fileViewModel(file, workItemId),
    validFrom: formatDateShortGds(file?.besEvidenceValidFromDate) || EM_DASH,
    expiryDate: formatDateShortGds(file?.besEvidenceExpiryDate) || EM_DASH
  }
}

/**
 * Figma's interim site fields, in order, plus re-accreditation's contact
 * phone. RA-782: exported for the ORS update's interim sites.
 */
export const INTERIM_FIELDS = [
  ['site-number', 'Site number', (site) => toDisplayLines(site.siteNumber)],
  ['location', 'Location', (site) => joined(interimSiteAddressLines(site))],
  ['contact-name', 'Contact name', (site) => toDisplayLines(site.contactName)],
  [
    'contact-email',
    'Contact email',
    (site) => toDisplayLines(site.contactEmail)
  ],
  [
    'contact-phone',
    'Contact phone number',
    (site) => toDisplayLines(site.contactPhone)
  ],
  [
    'operation-code',
    'Operation code',
    (site) => joined(toDisplayLines(site.operationCodes))
  ]
]

/**
 * One active interim site: a heading of its name and a short address (first
 * address line and country), then its fields, each with the dash when missing.
 */
function buildAddOrsInterimSite(site) {
  return {
    siteName: toDisplayLines(site.siteName)[0] ?? EM_DASH,
    shortAddress: [site.addressLine1, site.country]
      .flatMap(toDisplayLines)
      .join(', '),
    details: INTERIM_FIELDS.map(([key, label, read]) => ({
      key,
      label,
      values: orDash(read(site))
    }))
  }
}
