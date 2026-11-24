import { formatDateGds } from '#/config/nunjucks/filters/format-date.js'
import { formatSiteAddress } from '#/server/common/helpers/format/site-address.js'
import { materialLabel } from '#/server/work-items/core/materials.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import {
  EM_DASH,
  buildAuthorityToIssueContacts,
  buildBusinessPlanPairs,
  buildOverseasSites,
  deriveSiteAddressLines,
  fileViewModel,
  isExporterApplication,
  toDisplayLines,
  tonnageBandLabel
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
 * Organisation, Accreditation number, Accreditation status, Accreditation year,
 * Accreditation start date, Registration number, Location, Type, Material,
 * PRN tonnage, PRN authorisers, Authority to issue, Sampling and inspection
 * plan, Business plan, then for an exporter Broadly Equivalent Standards (BES)
 * and Overseas Reprocessing Site (ORS).
 *
 * Documents are listed from the live summary. Each clean file links to this
 * tab's own download route, which reads the summary afresh and serves only a
 * file in it. A file's S3 location is never put in a view model: it stays in
 * the summary read, server side.
 *
 * The authorisers are the one list the operator backend holds. PRN authorisers
 * shows each as `Name (email)`, Authority to issue shows the names only. The
 * operator backend never says which contacts are new, and no row marks one.
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

/** `Name (email)`; the email alone for an authoriser without a name. */
function authoriserLines(prns) {
  return buildAuthorityToIssueContacts(prns).map(({ name, email }) =>
    email ? `${name} (${email})` : name
  )
}

function authorityToIssueLines(prns) {
  return buildAuthorityToIssueContacts(prns).map(({ name }) => name)
}

/** This tab's download route for a file of the live summary. */
export function summaryFileHref(workItemId, fileId) {
  return `/work-items/${encodeURIComponent(workItemId)}/accreditation-summary/files/${encodeURIComponent(fileId)}/download`
}

/**
 * A file as the shared document item renders it, linked to this tab's download
 * route rather than the payload-based one. Only a clean file is linked.
 */
function summaryFileViewModel(file, workItemId) {
  const model = fileViewModel(file, workItemId)
  return {
    ...model,
    href: model.href ? summaryFileHref(workItemId, file.fileId) : null
  }
}

function filesOf(container) {
  return Array.isArray(container?.files) ? container.files : []
}

/**
 * Every file the live summary offers: the sampling plan's and each site's BES
 * evidence. The download route serves a file only if it is found here, so a
 * file that is not on the accreditation (including one on a site that is not
 * selected, which the operator backend never answers) is never served.
 *
 * @param {object} accreditation
 * @returns {object[]}
 */
export function summaryFiles(accreditation) {
  const sites = Array.isArray(accreditation?.overseasSites)
    ? accreditation.overseasSites
    : []
  return [
    ...filesOf(accreditation?.samplingPlan),
    ...sites.flatMap((site) => filesOf(site?.besEvidence))
  ]
}

function buildBesRow(accreditation, workItemId) {
  const sites = Array.isArray(accreditation.overseasSites)
    ? accreditation.overseasSites
    : []
  return {
    key: 'bes',
    label: 'Broadly Equivalent Standards (BES)',
    kind: 'bes-sites',
    sites: sites.map((site) => ({
      siteName: site?.siteName || EM_DASH,
      country: site?.country || null,
      files: filesOf(site?.besEvidence).map((file) =>
        summaryFileViewModel(file, workItemId)
      )
    }))
  }
}

function startDateText(accreditationStartDate) {
  return formatDateGds(accreditationStartDate) || EM_DASH
}

/**
 * The ORS row: each overseas site as the shared overseas site rendering takes
 * it, its ORS ID as the number ahead of its name. The summary address is kept
 * for every site, even one with a unique name, so a summary always shows
 * number, name and address.
 *
 * The operator backend answers selected sites only, in ORS ID then site ID
 * order, and never marks one new, so nothing is filtered, reordered or flagged
 * here.
 */
/**
 * The operator backend never returns these, and the tab never shows them: a
 * site stays new for the year after grant, so it would be marked new all year.
 * Dropped here so a body that did carry them could not bring them back.
 */
function withoutNewSiteMarkers(site) {
  const copy = { ...site }
  delete copy.isNewSite
  delete copy.registeredNowAccredited
  return copy
}

function buildOrsRow(accreditation) {
  const sources = (
    Array.isArray(accreditation.overseasSites)
      ? accreditation.overseasSites
      : []
  ).map(withoutNewSiteMarkers)
  // As on re-accreditation, a site's condensed address shows in the summary
  // only when its name repeats in the list.
  const sites = buildOverseasSites(sources).map((site, index) => ({
    ...site,
    siteNumber: toDisplayLines(sources[index]?.orsId)[0] ?? null
  }))
  return {
    key: 'ors',
    label: 'Overseas Reprocessing Site (ORS)',
    kind: 'overseas-sites',
    sites
  }
}

/**
 * @param {object} args
 * @param {object} args.accreditation the accreditation, as management-be answers it
 * @param {string|null} args.accreditationStartDate `yyyy-MM-dd`
 * @param {string} args.workItemId the case, for the download links
 * @returns {{ rows: object[], isExporter: boolean }}
 */
export function buildAccreditationSummary({
  accreditation,
  accreditationStartDate,
  workItemId
}) {
  const isExporter = isExporterApplication({ payload: accreditation })
  return {
    isExporter,
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
        label: 'Accreditation status',
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
      },
      {
        key: 'prn-tonnage',
        label: 'PRN tonnage',
        kind: 'text',
        value: tonnageBandLabel(accreditation.prns?.plannedTonnageBand)
      },
      {
        key: 'prn-authorisers',
        label: 'PRN authorisers',
        kind: 'lines',
        values: authoriserLines(accreditation.prns)
      },
      {
        key: 'authority-to-issue',
        label: 'Authority to issue',
        kind: 'lines',
        values: authorityToIssueLines(accreditation.prns)
      },
      {
        key: 'sampling-inspection-plan',
        label: 'Sampling and inspection plan',
        kind: 'files',
        files: filesOf(accreditation.samplingPlan).map((file) =>
          summaryFileViewModel(file, workItemId)
        )
      },
      {
        key: 'business-plan',
        label: 'Business plan',
        kind: 'pairs',
        pairs: buildBusinessPlanPairs(accreditation.businessPlan)
      },
      ...(isExporter
        ? [buildBesRow(accreditation, workItemId), buildOrsRow(accreditation)]
        : [])
    ]
  }
}
