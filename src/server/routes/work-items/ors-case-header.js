import { NO_PAYMENT } from '#/server/common/helpers/format/charge-amount.js'
import {
  assignedToEntry,
  chargeEntry,
  dueOnEntry,
  materialEntry,
  paymentDateEntry,
  requestTypeEntry,
  statusEntry,
  submittedByEntry,
  submittedOnEntry
} from './case-header.js'
import { EM_DASH } from './application-summary.js'
import { siteLocation } from './ors-summary-rows.js'

/**
 * The case header an ORS case shares: add-ORS's (RA-739 / RA-495) and the ORS
 * update's (RA-782). A site title ("Site name (ORS id)", as on the in-year
 * change list card), no organisation name or Org ID, and rows of four meta
 * items. Shared here rather than in either type's folder, as no type depends
 * on another's.
 *
 * Add-ORS's has no reference caption and no location: the breadcrumb already
 * shows the reference and the Application summary the location (user,
 * 2026-11-19). The ORS update's has both (RA-782 AC1), and, as it is never
 * paid for, the "no payment" marker for its charge and payment date (AC4).
 *
 * @param {object} args the `buildCaseHeader` arguments
 * @param {object} args.header the header fields every type shares
 * @param {object} args.workItem decorated work item
 * @param {object|null} args.assignment assignment view model, when available
 * @param {object} [options]
 * @param {boolean} [options.withReferenceAndLocation] show the application
 *   reference above the title and the site's location in the meta
 * @param {boolean} [options.charged] false for a type that is never charged
 * @returns {object} the `appCaseHeader` macro params
 */
export function buildOrsCaseHeader(
  { header, workItem, assignment },
  { withReferenceAndLocation = false, charged = true } = {}
) {
  const payload = workItem?.payload ?? {}
  const caption = withReferenceAndLocation
    ? { caption: header.applicationRef }
    : {}
  return {
    ...header,
    ...caption,
    title: siteTitle(payload.site),
    meta: meta({
      workItem,
      assignment,
      payload,
      withLocation: withReferenceAndLocation,
      charged
    })
  }
}

/**
 * A registration-only change: a registered ORS added to a registration that
 * has no accreditation, so the operator backend sends a registration
 * reference and no `accreditationReference`.
 */
export function isRegistrationOnlyChange(payload) {
  return Boolean(
    payload?.registrationReference && !payload.accreditationReference
  )
}

/** The site's address and country, as its Location row has them. */
function locationEntry(site) {
  return {
    key: 'location',
    label: 'Location',
    value: siteLocation(site)[0] ?? EM_DASH
  }
}

/**
 * The accreditation number, or, for a registration-only change, the
 * registration number. With neither, the accreditation number's dash.
 */
function referenceEntry(payload) {
  if (isRegistrationOnlyChange(payload)) {
    return {
      key: 'registration-number',
      label: 'Registration number',
      value: payload.registrationReference
    }
  }
  return {
    key: 'accreditation-number',
    label: 'Accreditation number',
    value: payload.accreditationReference || EM_DASH
  }
}

/** "Site name (ORS id)", as on the in-year change list card. */
function siteTitle(site) {
  const name = site?.siteName || EM_DASH
  return site?.orsId ? `${name} (${site.orsId})` : name
}

/**
 * The same fields in the same places as re-accreditation's (user,
 * 2026-11-19), with the accreditation number where it has the registration
 * number (and the registration number when there is no accreditation: see
 * `referenceEntry`). No Site ID (the title has the ORS id). The location,
 * when shown, follows the reference.
 *
 * The charge is the site's own (`site.chargePence`), always with pence
 * ("£328.00"). Submitted by and Submitted on end the header, as in
 * re-accreditation's. No Valid from date: the Application summary shows it
 * once the determination records one.
 */
function meta({ workItem, assignment, payload, withLocation, charged }) {
  return [
    requestTypeEntry(workItem),
    statusEntry(workItem),
    assignedToEntry(workItem, assignment),
    dueOnEntry(workItem),
    referenceEntry(payload),
    ...(withLocation ? [locationEntry(payload.site)] : []),
    materialEntry(payload),
    noPaymentUnless(charged, chargeEntry(payload.site?.chargePence)),
    noPaymentUnless(charged, paymentDateEntry(payload)),
    submittedByEntry(payload),
    submittedOnEntry(workItem)
  ]
}

/** An uncharged type's charge and payment date read as the "no payment" marker. */
function noPaymentUnless(charged, entry) {
  return charged ? entry : { ...entry, value: NO_PAYMENT }
}
