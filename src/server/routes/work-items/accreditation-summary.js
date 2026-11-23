import { formatDateGds } from '#/config/nunjucks/filters/format-date.js'
import { formatSiteAddress } from '#/server/common/helpers/format/site-address.js'
import { materialLabel } from '#/server/work-items/core/materials.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import {
  EM_DASH,
  deriveSiteAddressLines,
  isExporterApplication
} from './application-summary.js'

/**
 * Accreditation summary view model (RA-769): the rows of an In-Year Change
 * case's Accreditation summary tab, built from the accreditation management-be
 * reads live from the operator backend.
 *
 * The accreditation is shaped like the payload an application is submitted
 * with, so the Location, Type and Material rows reuse the Application summary
 * tab's own derivations: a row cannot disagree with that tab about which
 * applications get the registered address fallback.
 *
 * Rows are one ordered array of siblings, each with a stable `key` (its
 * `data-testid` suffix) and a `kind` the template switches on:
 * Organisation, Accreditation number, Status, Accreditation year,
 * Accreditation start date, Registration number, Location, Type, Material.
 */

/** Wording of the tab (confirmed by the user, RA-769 spec). */
export const ACCREDITATION_SUMMARY_HEADING = 'Accreditation Summary'
export const ACCREDITATION_SUMMARY_INTRO =
  'A summary of the accreditation as it stands today. The changes in this request are not included until the request is granted.'
export const ACCREDITATION_SUMMARY_UNAVAILABLE =
  'Accreditation summary is not available at the moment.'

/** An accreditation is only ever shown Granted: the operator backend answers for Approved ones only. */
const GRANTED_TEXT = 'Granted'
const GRANTED_STATE_ID = 'approved'

function textOrDash(value) {
  if (value === null || value === undefined) {
    return EM_DASH
  }
  const text = String(value).trim()
  return text === '' ? EM_DASH : text
}

/** `Name (ID)`; the name alone without an ID, the ID alone without a name. */
function organisationText({ organisationName, organisationNumber }) {
  const name = textOrDash(organisationName)
  const number = textOrDash(organisationNumber)
  if (number === EM_DASH) {
    return name
  }
  return name === EM_DASH ? number : `${name} (${number})`
}

function locationLines(accreditation) {
  const registeredAddress = formatSiteAddress({
    siteAddress: accreditation.companyRegisteredAddress
  })
  return deriveSiteAddressLines(accreditation, registeredAddress)
}

function typeText(accreditation) {
  return isExporterApplication({ payload: accreditation })
    ? 'Exporter accreditation'
    : 'Reprocessor accreditation'
}

function startDateText(accreditationStartDate) {
  return formatDateGds(accreditationStartDate) || EM_DASH
}

/**
 * @param {object} args
 * @param {object} args.accreditation the accreditation, as management-be answers it
 * @param {string|null} args.accreditationStartDate `yyyy-MM-dd`
 * @returns {{ rows: object[], isExporter: boolean }}
 */
export function buildAccreditationSummary({
  accreditation,
  accreditationStartDate
}) {
  return {
    isExporter: isExporterApplication({ payload: accreditation }),
    rows: [
      {
        key: 'organisation',
        label: 'Organisation',
        kind: 'text',
        value: organisationText(accreditation)
      },
      {
        key: 'accreditation-number',
        label: 'Accreditation number',
        kind: 'text',
        value: textOrDash(accreditation.accreditationNumber)
      },
      {
        key: 'status',
        label: 'Status',
        kind: 'tag',
        value: GRANTED_TEXT,
        tagClass: stateTagClass(GRANTED_STATE_ID)
      },
      {
        key: 'accreditation-year',
        label: 'Accreditation year',
        kind: 'text',
        value: textOrDash(accreditation.accreditationYear)
      },
      {
        key: 'accreditation-start-date',
        label: 'Accreditation start date',
        kind: 'text',
        value: startDateText(accreditationStartDate)
      },
      {
        key: 'registration-number',
        label: 'Registration number',
        kind: 'text',
        value: textOrDash(accreditation.registrationNumber)
      },
      {
        key: 'location',
        label: 'Location',
        kind: 'lines',
        values: locationLines(accreditation)
      },
      {
        key: 'type',
        label: 'Type',
        kind: 'text',
        value: typeText(accreditation)
      },
      {
        key: 'material',
        label: 'Material',
        kind: 'text',
        value: accreditation.material
          ? materialLabel(
              accreditation.material,
              accreditation.glassRecyclingProcess
            )
          : EM_DASH
      }
    ]
  }
}
