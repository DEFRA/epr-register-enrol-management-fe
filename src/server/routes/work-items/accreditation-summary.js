import { formatDateGds } from '#/config/nunjucks/filters/format-date.js'
import { formatSiteAddress } from '#/server/common/helpers/format/site-address.js'
import { materialLabel } from '#/server/work-items/core/materials.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { STATE_APPROVED } from '#/server/work-items/core/standard-workflow.js'
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

/** Wording of the tab. */
export const ACCREDITATION_SUMMARY_HEADING = 'Accreditation Summary'
export const ACCREDITATION_SUMMARY_INTRO =
  'A summary of the accreditation as it stands today. The changes in this request are not included until the request is granted.'
export const ACCREDITATION_SUMMARY_UNAVAILABLE =
  'Accreditation summary is not available at the moment.'

/**
 * The accreditation status is the constant "Granted", not data. That is only
 * true because the operator backend answers 404 for an accreditation that is
 * not Approved, and its response carries no status of its own. Once an
 * accreditation can be suspended or revoked, the status must come from the
 * backend and be rendered from the response here, or a suspended accreditation
 * would show "Granted".
 */
const GRANTED_TEXT = 'Granted'

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

function overseasSitesOf(accreditation) {
  return Array.isArray(accreditation?.overseasSites)
    ? accreditation.overseasSites
    : []
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
  return [
    ...filesOf(accreditation?.samplingPlan),
    ...overseasSitesOf(accreditation).flatMap((site) =>
      filesOf(site?.besEvidence)
    )
  ]
}

function buildBesRow(accreditation, workItemId) {
  const sites = overseasSitesOf(accreditation)
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

/** An interim site without its new marker. */
function withoutNewMarker(interimSite) {
  if (interimSite == null || typeof interimSite !== 'object') {
    return interimSite
  }
  const { isNewSite: _isNewSite, ...rest } = interimSite
  return rest
}

/**
 * The one place the tab keeps new-site markers out: a site stays new for the
 * year after grant, so it would be marked new all year. The operator backend
 * never returns these; dropping them here (from the site and its interim
 * sites) means a body that did carry them could not bring them back, and the
 * template needs no option of its own.
 */
function withoutNewSiteMarkers(site) {
  const {
    isNewSite: _isNewSite,
    registeredNowAccredited: _registeredNowAccredited,
    ...rest
  } = site
  if (Array.isArray(rest.interimSites)) {
    rest.interimSites = rest.interimSites.map(withoutNewMarker)
  }
  if (rest.interimSite != null) {
    rest.interimSite = withoutNewMarker(rest.interimSite)
  }
  return rest
}

/**
 * The ORS row: each overseas site as the shared overseas site rendering takes
 * it, its ORS ID as the number ahead of its name. As on re-accreditation, a
 * site's condensed address shows in the summary only when its name repeats in
 * the list.
 *
 * The operator backend answers selected sites only, in ORS ID then site ID
 * order, and never marks one new, so nothing is filtered, reordered or flagged
 * here.
 */
function buildOrsRow(accreditation) {
  const sources = overseasSitesOf(accreditation).map(withoutNewSiteMarkers)
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
      ...identityRows(accreditation, accreditationStartDate),
      ...prnRows(accreditation),
      ...planRows(accreditation, workItemId),
      ...(isExporter
        ? [buildBesRow(accreditation, workItemId), buildOrsRow(accreditation)]
        : [])
    ]
  }
}

/**
 * Who and what is accredited: organisation, numbers, status, dates, location, type and material.
 * @param {object} accreditation
 * @param {string|null} accreditationStartDate `yyyy-MM-dd`
 * @returns {object[]}
 */
function identityRows(accreditation, accreditationStartDate) {
  return [
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
      tagClass: stateTagClass(STATE_APPROVED)
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

/**
 * @param {object} accreditation
 * @returns {object[]}
 */
function prnRows(accreditation) {
  return [
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
    }
  ]
}

/**
 * @param {object} accreditation
 * @param {string} workItemId the case, for the download links
 * @returns {object[]}
 */
function planRows(accreditation, workItemId) {
  return [
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
    }
  ]
}
