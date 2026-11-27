import {
  INTERIM_FIELDS,
  SITE_FIELDS,
  besFileViewModel,
  orDash
} from '#/server/routes/add-overseas-site/application-summary.js'
import { EM_DASH } from '#/server/routes/work-items/application-summary.js'

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
 * The rows, labels and readers are add-ORS's (`SITE_FIELDS`,
 * `INTERIM_FIELDS`), so the two summaries never describe an ORS differently.
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
  const orsId = textOr(site.orsId, EM_DASH)
  const accreditation = year
    ? `their ${year} accreditation`
    : 'their accreditation'
  return `The operator wants to change the details of ORS ${orsId}, which is on ${accreditation}. Each changed detail is marked.`
}

function textOr(value, fallback) {
  if (value == null) {
    return fallback
  }
  const text = String(value).trim()
  return text === '' ? fallback : text
}

/**
 * The details the operator may change (`OverseasSiteDetails` in the operator
 * backend), by `SITE_FIELDS` key. The location row is the address, which is
 * editable, plus the country, which is not: its country comes from the site on
 * both sides.
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
  // `previous` / `proposed` override the site's own values only for the
  // details they hold. A cleared optional detail is sent as null and must
  // stay cleared, so spread rather than `??` per field.
  const current = { ...site, ...detailsOf(site.previous) }
  const requested = { ...site, ...detailsOf(site.proposed) }
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

function detailsOf(details) {
  return details != null && typeof details === 'object' ? details : {}
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

function filesIn(container) {
  const files = container?.files
  return Array.isArray(files) ? files : []
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
 * One section per interim site: every active one, in the site's order, with
 * what the update does to it, then the ones the update adds. A change or
 * removal whose interim site is not in the list (it has since gone) still
 * shows, from the details the change carries. A site the operator withdrew
 * before the update is not shown.
 */
function interimSites(site) {
  const changes = Array.isArray(site.interimSiteChanges)
    ? site.interimSiteChanges.filter((change) => change != null)
    : []
  const changeFor = new Map(
    changes
      .filter((change) => change.action !== ADD && change.interimSiteId != null)
      .map((change) => [String(change.interimSiteId), change])
  )

  const active = (
    Array.isArray(site.interimSites) ? site.interimSites : []
  ).filter((interim) => interim != null && interim.removedAt == null)
  const shown = new Set()
  const entries = active.map((interim) => {
    const id = interim.siteId == null ? null : String(interim.siteId)
    const change = id == null ? undefined : changeFor.get(id)
    if (change) {
      shown.add(change)
    }
    return { interim, change }
  })
  for (const change of changes) {
    if (change.action !== ADD && !shown.has(change)) {
      entries.push({ interim: {}, change })
    }
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

function interimSection(number, interim, change) {
  if (change?.action === ADD) {
    const proposed = detailsOf(change.proposed)
    return listSection(number, proposed, {
      kind: 'added',
      tag: 'New interim site',
      tagClass: 'govuk-tag--purple',
      note: 'This interim site is new. There is no previous version to compare it with.',
      open: true
    })
  }

  const current = { ...interim, ...detailsOf(change?.previous) }
  if (change?.action === REMOVE) {
    return listSection(number, current, {
      kind: 'removed',
      tag: 'Removed',
      tagClass: 'govuk-tag--red',
      note: 'The operator wants to remove this interim site.',
      open: true
    })
  }

  const requested =
    change?.action === CHANGE
      ? { ...interim, ...detailsOf(change.proposed) }
      : current
  const rows = INTERIM_FIELDS.map(([key, label, read]) =>
    compareRow(key, label, read(current), read(requested))
  )
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

/** A new or removed interim site: its details as a list, nothing to compare. */
function listSection(number, details, section) {
  return {
    number,
    siteName: nameOf(details),
    ...section,
    rows: null,
    details: INTERIM_FIELDS.map(([key, label, read]) => ({
      key,
      label,
      values: orDash(read(details))
    }))
  }
}

function nameOf(details) {
  return textOr(details?.siteName, EM_DASH)
}
