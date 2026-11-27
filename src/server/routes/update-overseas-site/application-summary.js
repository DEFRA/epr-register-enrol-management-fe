import {
  INTERIM_FIELDS,
  SITE_FIELDS,
  besFileViewModel,
  buildOrsInterimSite,
  orDash
} from '#/server/routes/work-items/ors-summary-rows.js'
import {
  EM_DASH,
  buildInterimSites,
  filesIn,
  firstLineOr
} from '#/server/routes/work-items/application-summary.js'

/**
 * RA-782. The ORS update's Application summary, from the "EPR Management UI"
 * design (change ORS details and interim sites screens): the ORS's details,
 * current version against requested change, its BES evidence with any files
 * the update adds, and its interim sites, each marked with what the update
 * does to it.
 *
 * The operator backend sends the ORS as it stands (`payload.site`, add-ORS's
 * site shape) with `previous` and `proposed`: the details the operator may
 * change, as they were and as requested. The other details (country,
 * coordinates, recycling operations, Basel codes, conditions of export) are
 * locked, so they show the same on both sides, from `payload.site`.
 * `interimSiteChanges` lists what the update does to the interim sites
 * (`change`, `add`, `remove`), and `addedBesEvidence` the BES evidence files
 * it adds to the ORS's own (`besEvidence`).
 *
 * The operator backend serialises with `WhenWritingNull`, so a cleared
 * optional detail is ABSENT from `previous` / `proposed` (and from an interim
 * change's), not null. Each is therefore read as a whole set of details: a
 * missing key is an empty detail, never a reason to fall back to the site's.
 *
 * The rows, labels and readers are the ones add-ORS's summary uses
 * (`ors-summary-rows.js`), so the two never describe an ORS differently.
 *
 * @param {object} args
 * @param {object} args.workItem decorated work item
 * @returns {{ intro: string, groups: object[], besEvidence: object, interimSites: object[] }}
 */
export function buildUpdateOverseasSiteSummary({ workItem }) {
  const payload = workItem?.payload ?? {}
  const site = payload.site ?? {}
  const workItemId = workItem?.id ?? ''

  return {
    intro: introFor(site, payload.accreditationYear),
    groups: siteGroups(site),
    besEvidence: besEvidence(site, workItemId),
    interimSites: interimSites(site)
  }
}

function introFor(site, year) {
  const orsId = firstLineOr(site.orsId, EM_DASH)
  const accreditation = year
    ? `their ${year} accreditation`
    : 'their accreditation'
  // Provisional copy: not in the design, pending content design review.
  return `The operator wants to change the details of ORS ${orsId}, which is on ${accreditation}. Each changed detail is marked.`
}

/**
 * The details the operator may change: management-be's and the operator
 * backend's `OverseasSiteDetails`, the whole of `previous` and `proposed`.
 */
const EDITABLE_DETAILS = [
  'siteName',
  'addressLine1',
  'addressLine2',
  'townOrCity',
  'contactName',
  'contactEmail',
  'contactPhone',
  'repatriatedLoads'
]

/**
 * The same details by `SITE_FIELDS` key. The location row is the address,
 * which is editable, plus the country, which is not: its country comes from
 * the site on both sides.
 */
const EDITABLE_KEYS = new Set([
  'site-name',
  'location',
  'contact-name',
  'contact-email',
  'contact-phone',
  'repatriated-loads'
])

/** The design's groups, as the operator's journey has them. */
const GROUPS = [
  {
    key: 'site-details',
    title: 'Site details',
    keys: ['ors-id', 'site-name', 'location', 'coordinates']
  },
  {
    key: 'contact-details',
    title: 'Contact details',
    keys: ['contact-name', 'contact-email', 'contact-phone']
  },
  {
    key: 'operations',
    title: 'Operations',
    keys: [
      'recycling-operation',
      'basel-codes',
      'repatriated-loads',
      'conditions-of-export'
    ]
  }
]

const SITE_FIELDS_BY_KEY = new Map(
  SITE_FIELDS.map(([key, label, read]) => [key, { label, read }])
)

function siteGroups(site) {
  const current = withEditableDetails(site, site.previous)
  const requested = withEditableDetails(site, site.proposed)
  return GROUPS.map(({ key, title, keys }) => ({
    key,
    title,
    rows: keys.map((fieldKey) => {
      const { label, read } = SITE_FIELDS_BY_KEY.get(fieldKey)
      const editable = EDITABLE_KEYS.has(fieldKey)
      return compareRow(
        fieldKey,
        label,
        read(editable ? current : site),
        read(editable ? requested : site)
      )
    })
  }))
}

/**
 * The site with its editable details as `details` has them, a key missing
 * from `details` read as empty (the operator cleared it). Only when there is
 * no `details` at all are the site's own shown.
 */
function withEditableDetails(site, details) {
  if (!isDetails(details)) {
    return site
  }
  return {
    ...site,
    ...Object.fromEntries(
      EDITABLE_DETAILS.map((key) => [key, details[key] ?? null])
    )
  }
}

function isDetails(value) {
  return value != null && typeof value === 'object'
}

/** A Detail | Current version | Requested change row. */
function compareRow(key, label, currentLines, requestedLines) {
  return {
    key,
    label,
    current: orDash(currentLines),
    requested: orDash(requestedLines),
    changed: currentLines.join('\n') !== requestedLines.join('\n')
  }
}

/**
 * The ORS's BES evidence files, then the ones the update adds, each marked
 * `isNew`. Every clean file links to the payload download route, which finds
 * both.
 */
function besEvidence(site, workItemId) {
  const files = [
    ...filesIn(site.besEvidence).map((file) => ({
      ...besFileViewModel(file, workItemId),
      isNew: false
    })),
    ...filesIn(site.addedBesEvidence).map((file) => ({
      ...besFileViewModel(file, workItemId),
      isNew: true
    }))
  ]
  return { files }
}

const CHANGE = 'change'
const ADD = 'add'
const REMOVE = 'remove'

/**
 * One section per interim site: every active one (the shared
 * `buildInterimSites`, with its fallback to the pre-RA-603 `interimSite`), in
 * the site's order, with what the update does to it, then the ones the update
 * adds. A change or removal whose interim site is not in the list (it has
 * since gone) still shows, from the details the change carries; one with no
 * interim site id names no site, so it is not shown. A site the operator
 * withdrew before the update is not shown.
 */
function interimSites(site) {
  const changes = Array.isArray(site.interimSiteChanges)
    ? site.interimSiteChanges.filter((change) => change != null)
    : []
  const unmatched = new Map(
    changes
      .filter((change) => change.action !== ADD && change.interimSiteId != null)
      .map((change) => [String(change.interimSiteId), change])
  )

  const entries = buildInterimSites(site, (interim) => {
    const id = interim.siteId == null ? null : String(interim.siteId)
    const change = unmatched.get(id)
    unmatched.delete(id)
    return { interim, change }
  })
  for (const change of unmatched.values()) {
    entries.push({ interim: {}, change })
  }
  for (const change of changes) {
    if (change.action === ADD) {
      entries.push({ interim: null, change })
    }
  }

  return entries.map(({ interim, change }, index) =>
    interimSection(index + 1, interim, change)
  )
}

// Provisional copy: not in the design, pending content design review.
const ADDED_SECTION = {
  kind: 'added',
  tag: 'New interim site',
  tagClass: 'govuk-tag--purple',
  note: 'This interim site is new. There is no previous version to compare it with.',
  open: true
}

// Provisional copy: not in the design, pending content design review.
const REMOVED_SECTION = {
  kind: 'removed',
  tag: 'Removed',
  tagClass: 'govuk-tag--red',
  note: 'The operator wants to remove this interim site.',
  open: true
}

function interimSection(number, interim, change) {
  if (change?.action === ADD) {
    return listSection(number, detailsOf(change.proposed), ADDED_SECTION)
  }

  const current = interimVersion(interim, change?.previous)
  if (change?.action === REMOVE) {
    return listSection(number, current, REMOVED_SECTION)
  }
  return compareSection(number, interim, current, change)
}

/** An existing interim site, current version against requested change. */
function compareSection(number, interim, current, change) {
  const requested =
    change?.action === CHANGE
      ? interimVersion(interim, change.proposed)
      : current
  // The section's title shows only the requested name, so a rename needs its own row to show the old one.
  const rows = [
    compareRow(
      'site-name',
      'Site name',
      [nameOf(current)],
      [nameOf(requested)]
    ),
    ...INTERIM_FIELDS.map(([key, label, read]) =>
      compareRow(key, label, read(current), read(requested))
    )
  ]
  const changed = rows.some((row) => row.changed)
  return {
    number,
    siteName: nameOf(requested),
    kind: changed ? 'changed' : 'unchanged',
    tag: changed ? 'Changed' : 'No changes',
    tagClass: changed ? 'govuk-tag--blue' : 'govuk-tag--grey',
    note: null,
    open: changed,
    rows,
    details: null
  }
}

function detailsOf(details) {
  return isDetails(details) ? details : {}
}

/**
 * One side of an interim site's change. An interim change's `previous` and
 * `proposed` carry the site's full details (`InterimSiteDetails`, a cleared
 * optional one absent), so they are used as they are; only the site number,
 * which is not a detail, comes from the interim site. With no details, the
 * interim site as it stands.
 */
function interimVersion(interim, details) {
  return isDetails(details)
    ? { ...details, siteNumber: interim?.siteNumber }
    : interim
}

/**
 * A new or removed interim site: its details as a list, nothing to compare,
 * as add-ORS lists an interim site.
 */
function listSection(number, details, section) {
  const { siteName, details: rows } = buildOrsInterimSite(details)
  return {
    number,
    siteName,
    ...section,
    rows: null,
    details: rows
  }
}

function nameOf(details) {
  return firstLineOr(details?.siteName, EM_DASH)
}
