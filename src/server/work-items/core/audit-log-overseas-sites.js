/**
 * Audit log rendering for overseas sites corrections (RA-768).
 *
 * management-be's `POST /work-items/re-accreditation/{id}/overseas-sites/remove`
 * appends an `overseas-sites-corrected` entry (no state change) when the
 * one-off RA-768 migration removes sites the operator deselected in a query
 * resubmission before RA-557. Audit `details` is a flat string-to-string map
 * on the backend (`WorkItemAuditEntry.Details` is
 * `Dictionary<string, string?>`), so the removed sites arrive as a
 * JSON-encoded string:
 *
 *   { removedSites: '[{"orsId":"ORS-123","siteId":"1"},{"orsId":null,"siteId":"3"}]',
 *     reason: 'RA-768: ...' }
 *
 * Only site ids are carried, never site names, addresses or contacts. Every
 * removed site has a non-empty `orsId` or `siteId`, and `reason` is required
 * by the endpoint, so none of these are optional. An entry that breaks that
 * shape is not rendered as if it were fine: its rows say the details could
 * not be shown, and `decorateAuditLog` logs it at Error.
 */

export const OVERSEAS_SITES_CORRECTED_ACTION = 'overseas-sites-corrected'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isValidSite(site) {
  return (
    isPlainObject(site) &&
    (isNonEmptyString(site.orsId) || isNonEmptyString(site.siteId))
  )
}

/** The removed sites, or null when `removedSites` is not a valid list. */
function parseRemovedSites(raw) {
  if (!isNonEmptyString(raw)) {
    return { sites: null, problem: 'details.removedSites' }
  }
  let sites
  try {
    sites = JSON.parse(raw)
  } catch {
    return { sites: null, problem: 'details.removedSites (not valid JSON)' }
  }
  if (!Array.isArray(sites) || sites.length === 0) {
    return {
      sites: null,
      problem: 'details.removedSites (not a non-empty list)'
    }
  }
  const badIndex = sites.findIndex((site) => !isValidSite(site))
  if (badIndex !== -1) {
    return { sites: null, problem: `details.removedSites[${badIndex}]` }
  }
  return { sites, problem: null }
}

/**
 * Read an entry's `details` into the removed sites and the reason, with the
 * paths of any required fields that are missing or malformed (`problems` is
 * empty when the entry has the shape management-be writes).
 */
function readOverseasSitesCorrected(details) {
  if (!isPlainObject(details)) {
    return { sites: null, reason: null, problems: ['details'] }
  }
  const { sites, problem } = parseRemovedSites(details.removedSites)
  const reason = isNonEmptyString(details.reason) ? details.reason : null
  const problems = [problem, reason ? null : 'details.reason'].filter(Boolean)
  return { sites, reason, problems }
}

/**
 * A removed site as the caseworker knows it. The ORS id is what the Case Management
 * overseas sites page labels "ORS ID"; the endpoint matches on `siteId`
 * only when the site has no ORS id, so that is the only time it is shown.
 */
function siteLabel(site) {
  return isNonEmptyString(site.orsId)
    ? `ORS ID: ${site.orsId}`
    : `Site ID: ${site.siteId}`
}

/** At-a-glance summary: the removed sites, comma separated. */
export function summariseOverseasSitesCorrected(details) {
  const { sites } = readOverseasSitesCorrected(details)
  return sites ? sites.map(siteLabel).join(', ') : ''
}

/**
 * Detail rows: the removed sites (one per line) and the reason. When a
 * required field is missing or malformed, a "Details" row says which part
 * could not be shown instead of the row being silently dropped.
 */
export function overseasSitesCorrectedRows(details) {
  const { sites, reason } = readOverseasSitesCorrected(details)
  const rows = []
  if (sites) {
    rows.push({
      key: 'Removed sites',
      value: sites.map(siteLabel).join('\n'),
      multiline: true
    })
  }
  if (reason) {
    rows.push({ key: 'Reason', value: reason, multiline: true })
  }
  if (!sites || !reason) {
    const missing = [sites ? null : 'removed sites', reason ? null : 'reason']
      .filter(Boolean)
      .join(' and the ')
    rows.push({
      key: 'Details',
      value: `The ${missing} could not be shown because this entry's details are missing or unreadable.`
    })
  }
  return rows
}

/**
 * Log, at Error, an `overseas-sites-corrected` entry whose required
 * `details` are missing or malformed (`decorateAuditLog` calls this for
 * every entry). Only ids and field paths are logged, never the details
 * themselves. A malformed entry with no logger to report it to is a wiring
 * bug, so it throws rather than going unnoticed.
 */
export function logMalformedOverseasSitesCorrected(
  entry,
  { logger, workItemId }
) {
  if (entry?.action !== OVERSEAS_SITES_CORRECTED_ACTION) {
    return
  }
  const invalidFields = readOverseasSitesCorrected(entry.details).problems
  if (invalidFields.length === 0) {
    return
  }
  if (typeof logger?.error !== 'function') {
    throw new TypeError(
      'decorateAuditLog needs a logger to report a malformed audit entry'
    )
  }
  logger.error(
    {
      workItemId,
      auditEntryId: entry.id,
      auditAction: entry.action,
      auditEntryCreatedAt: entry.createdAt,
      invalidFields
    },
    'Audit entry has missing or malformed details; showing it without them'
  )
}
