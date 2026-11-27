import { formatDateShortGds } from '#/config/nunjucks/filters/format-date.js'
import {
  EM_DASH,
  fileViewModel,
  interimSiteAddressLines,
  overseasSiteAddressLines,
  toDisplayLines
} from './application-summary.js'

/**
 * The rows an ORS case's Application summary describes an overseas
 * reprocessing site and its interim sites with: add-ORS's (RA-739 / RA-495)
 * and the ORS update's (RA-782), so the two never describe an ORS
 * differently. Shared here rather than in either type's folder, as no type
 * depends on another's.
 */

/** One comma-separated line, or nothing when there are no parts. */
function joined(lines) {
  return lines.length > 0 ? [lines.join(', ')] : []
}

/** The lines, or the dash when there are none. */
export function orDash(lines) {
  return lines.length > 0 ? lines : [EM_DASH]
}

/**
 * The site's location: its address parts and country, as one line. The
 * Location row, and the ORS update's case header (RA-782 AC1).
 *
 * @returns {string[]} one line, or none when the site has no address
 */
export function siteLocation(site) {
  return joined(overseasSiteAddressLines(site ?? {}, false))
}

/**
 * Figma's labels and order. Keys form the `app-detail-*` testids. The fourth
 * entry, where there is one, is the operator backend's name for the field
 * when the operator supplied it (`ChangeRequestRules`: the four fields an
 * ORS may lack and the operator then answers on the request). The location
 * row is marked when the operator supplied the country.
 */
export const SITE_FIELDS = [
  ['site-name', 'Site name', (site) => toDisplayLines(site.siteName)],
  ['location', 'Location', siteLocation, 'country'],
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
 * phone.
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
 * One interim site as a list: a heading of its name and a short address
 * (first address line and country), then its fields, each with the dash when
 * missing. Add-ORS's interim sites, and the ORS update's new and removed ones.
 */
export function buildOrsInterimSite(site) {
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
