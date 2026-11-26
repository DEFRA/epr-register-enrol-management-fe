import { formatDateTimeGds } from '#/config/nunjucks/filters/format-date.js'
import {
  EM_DASH,
  fileViewModel,
  toDisplayLines
} from '#/server/routes/work-items/application-summary.js'

/**
 * RA-698. The operator's response to an add-ORS query, as management-be
 * records it on the work item's payload (`payload.latestQueryResponse`) when
 * the operator resubmits (`resume-from-query`):
 *  - `siteChanges`: ORS field -> `{ from, to }`;
 *  - `interimSiteChanges[]`: `{ siteId, siteNumber, changes }`, changes as above;
 *  - `besEvidenceFiles[]`: the new files (`fileId`, `filename`, `s3Key`, ...);
 *  - `responderContactDetails` (`fullName`, `role`) and `submittedAt`.
 * Only the latest response is kept there; earlier ones are on the audit log
 * as `query-responded` entries.
 */

const SITE_FIELD_LABELS = {
  siteName: 'ORS name',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  townOrCity: 'Town or city',
  stateOrRegion: 'State or region',
  postcode: 'Postcode',
  contactName: 'Contact name',
  contactEmail: 'Contact email',
  contactPhone: 'Contact phone number',
  rejectedLoadsArrangements: 'Arrangements for rejected or returned loads'
}

/** The latest response recorded on the work item, or null. */
export function findOperatorResponse(workItem) {
  const latest = workItem?.payload?.latestQueryResponse
  return latest != null && typeof latest === 'object' ? latest : null
}

/**
 * Raw BES files the operator uploaded in their latest response. The backend
 * only accepts files its upload scan has cleared, so they are shown as clean.
 */
export function operatorResponseBesFiles(workItem) {
  const files = findOperatorResponse(workItem)?.besEvidenceFiles
  return Array.isArray(files)
    ? files.map((file) => ({ scanStatus: 'Clean', ...file }))
    : []
}

const text = (value) => {
  const lines = toDisplayLines(value)
  return lines.length > 0 ? lines.join(', ') : EM_DASH
}

const isPair = (value) =>
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  ('to' in value || 'new' in value || 'current' in value)

function changeRows(changes, previous = {}) {
  return Object.entries(changes ?? {}).map(([key, value]) => {
    const pair = isPair(value)
    const oldValue = pair
      ? 'from' in value
        ? value.from
        : (value.old ?? value.previous)
      : previous[key]
    const newValue = pair ? (value.to ?? value.new ?? value.current) : value
    return {
      key,
      label: SITE_FIELD_LABELS[key] ?? key,
      oldValue: oldValue === undefined ? null : text(oldValue),
      newValue: text(newValue)
    }
  })
}

function interimSiteName(site, response) {
  const interimSites = Array.isArray(site?.interimSites)
    ? site.interimSites
    : []
  const found = interimSites.find(
    (s) =>
      (response.siteId != null && s.siteId === response.siteId) ||
      (response.siteNumber != null && s.siteNumber === response.siteNumber)
  )
  return found?.siteName ?? null
}

function submitterOf(response) {
  const { fullName, role } = response.responderContactDetails ?? {}
  return [fullName, role].filter(Boolean).join(', ') || EM_DASH
}

/**
 * @param {object} args
 * @param {object} args.workItem decorated work item (its `payload.latestQueryResponse` is read)
 * @returns {object|null} null when the operator has not responded
 */
export function buildOperatorResponse({ workItem }) {
  const response = findOperatorResponse(workItem)
  if (!response) {
    return null
  }
  const site = workItem?.payload?.site ?? {}
  const workItemId = workItem?.id ?? ''
  const siteChanges = changeRows(response.siteChanges)
  const interimSites = (
    Array.isArray(response.interimSiteChanges)
      ? response.interimSiteChanges
      : []
  ).map((interim) => ({
    siteNumber: interim.siteNumber ?? null,
    siteName: interimSiteName(site, interim),
    changes: changeRows(interim.changes)
  }))
  return {
    submittedBy: submitterOf(response),
    submittedAt:
      formatDateTimeGds(response.submittedAt ?? response.respondedAt) ||
      EM_DASH,
    changes: siteChanges,
    interimSites: interimSites.filter((i) => i.changes.length > 0),
    besFiles: operatorResponseBesFiles(workItem).map((file) =>
      fileViewModel(file, workItemId)
    )
  }
}
