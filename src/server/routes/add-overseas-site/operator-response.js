import { formatDateTimeGds } from '#/config/nunjucks/filters/format-date.js'
import {
  EM_DASH,
  fileViewModel,
  toDisplayLines
} from '#/server/routes/work-items/application-summary.js'

/**
 * RA-698. The operator's response to an add-ORS query, as management-be
 * records it on the work item's audit log when the operator resubmits
 * (`resume-from-query`): the changed ORS values, the changed interim-site
 * values, the new BES evidence files, and who submitted it and when.
 *
 * Contract assumed from management-be (MBE-4), kept tolerant on purpose
 * because that endpoint was built in parallel:
 *  - the entry's action names a resume / query response (see
 *    `isOperatorResponseEntry`);
 *  - `details.changes` (or `details.site`): ORS field -> new value, or
 *    `{ from, to }` / `{ old, new }` where the old value is also recorded;
 *  - `details.interimSites[]`: `{ siteId, siteNumber, changes }`;
 *  - `details.besEvidenceFiles[]`: `{ fileId, filename, ... }`;
 *  - `details.submittedBy` / `details.submittedAt` (falling back to the
 *    entry's own `createdByName` / `createdAt`).
 * When only the new value is recorded, the old one is read from the
 * `previousValues` the caller supplies, else shown as not recorded.
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

const RESPONSE_ACTION = /resume|query-response|query-responded/

/** Is this audit entry the operator's response to a query? */
export function isOperatorResponseEntry(entry) {
  const details = entry?.details
  return (
    typeof entry?.action === 'string' &&
    RESPONSE_ACTION.test(entry.action) &&
    details != null &&
    typeof details === 'object' &&
    (details.changes != null ||
      details.site != null ||
      Array.isArray(details.interimSites) ||
      Array.isArray(details.besEvidenceFiles))
  )
}

/** The latest response entry (the audit log is newest-first), or null. */
export function findOperatorResponse(auditLog) {
  return (
    (Array.isArray(auditLog) ? auditLog : []).find(isOperatorResponseEntry) ??
    null
  )
}

/** Raw BES files the operator uploaded in their latest response. */
export function operatorResponseBesFiles(workItem) {
  const files = findOperatorResponse(workItem?.auditLog)?.details
    ?.besEvidenceFiles
  return Array.isArray(files) ? files : []
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
      ? (value.from ?? value.old ?? value.previous)
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

/**
 * @param {object} args
 * @param {object} args.workItem decorated work item (its `auditLog` is read)
 * @returns {object|null} null when the operator has not responded
 */
export function buildOperatorResponse({ workItem }) {
  const entry = findOperatorResponse(workItem?.auditLog)
  if (!entry) {
    return null
  }
  const details = entry.details
  const site = workItem?.payload?.site ?? {}
  const workItemId = workItem?.id ?? ''
  const siteChanges = changeRows(details.changes ?? details.site)
  const interimSites = (
    Array.isArray(details.interimSites) ? details.interimSites : []
  ).map((interim) => ({
    siteNumber: interim.siteNumber ?? null,
    siteName: interimSiteName(site, interim),
    changes: changeRows(interim.changes)
  }))
  return {
    submittedBy: details.submittedBy ?? entry.createdByName ?? EM_DASH,
    submittedAt:
      formatDateTimeGds(details.submittedAt ?? entry.createdAt) || EM_DASH,
    changes: siteChanges,
    interimSites: interimSites.filter((i) => i.changes.length > 0),
    besFiles: operatorResponseBesFiles(workItem).map((file) =>
      fileViewModel(file, workItemId)
    )
  }
}
