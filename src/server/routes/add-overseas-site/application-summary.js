import { formatDateShortGds } from '#/config/nunjucks/filters/format-date.js'
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
 * gap. ORS ID, EU and OECD are not shown (the design has no rows for them),
 * and neither is which values the operator supplied (RA-495).
 *
 * @param {object} args
 * @param {object} args.workItem decorated work item
 * @returns {{ rows: object[], interimSites: object[] }}
 */
export function buildAddOverseasSiteSummary({ workItem }) {
  const site = workItem?.payload?.site ?? {}
  const workItemId = workItem?.id ?? ''

  return {
    rows: [
      ...SITE_FIELDS.map(([key, label, read]) => ({
        key,
        label,
        kind: 'lines',
        values: orDash(read(site))
      })),
      {
        key: 'bes-evidence',
        label: 'Evidence of broadly equivalent standards',
        kind: 'files',
        files: besFilesOf(site).map((file) =>
          besFileViewModel(file, workItemId)
        )
      }
    ],
    interimSites: buildInterimSites(site, buildAddOrsInterimSite)
  }
}

/** One comma-separated line, or nothing when there are no parts. */
function joined(lines) {
  return lines.length > 0 ? [lines.join(', ')] : []
}

function orDash(lines) {
  return lines.length > 0 ? lines : [EM_DASH]
}

/** Figma's labels and order. Keys form the `app-detail-*` testids. */
const SITE_FIELDS = [
  ['site-name', 'Site name', (site) => toDisplayLines(site.siteName)],
  [
    'location',
    'Location',
    (site) => joined(overseasSiteAddressLines(site, false))
  ],
  // Not in the Figma frame: re-accreditation's site view wording.
  ['coordinates', 'Coordinates', (site) => toDisplayLines(site.coordinates)],
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
    'recycling-operation',
    'Recycling operation',
    (site) => joined(toDisplayLines(site.operationCodes))
  ],
  [
    'basel-codes',
    'Basel convention codes',
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
    (site) => toDisplayLines(site.conditionsOfExport)
  ]
]

function besFilesOf(site) {
  const files = site.besEvidence?.files
  return Array.isArray(files) ? files : []
}

/** The shared file view model (Clean-only link), plus the BES dates. */
function besFileViewModel(file, workItemId) {
  return {
    ...fileViewModel(file, workItemId),
    validFrom: formatDateShortGds(file?.besEvidenceValidFromDate) || EM_DASH,
    expiryDate: formatDateShortGds(file?.besEvidenceExpiryDate) || EM_DASH
  }
}

/** Figma's interim site fields, in order. */
const INTERIM_FIELDS = [
  ['site-number', 'Site number', (site) => toDisplayLines(site.siteNumber)],
  ['location', 'Location', (site) => joined(interimSiteAddressLines(site))],
  ['contact-name', 'Contact name', (site) => toDisplayLines(site.contactName)],
  [
    'contact-email',
    'Contact email',
    (site) => toDisplayLines(site.contactEmail)
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
