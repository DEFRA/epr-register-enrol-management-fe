import { formatDateTimeGds } from '#/config/nunjucks/filters/format-date.js'
import {
  formatSiteAddress,
  getSitePostcode
} from '#/server/common/helpers/format/site-address.js'
import { materialLabel } from '#/server/work-items/core/materials.js'

/**
 * Application information view model (RA-295 AC02).
 *
 * RA-295 folds the former two-step `/work-items/{id}/application-details`
 * page into the work item detail page, so every piece of submitted
 * application data is on one page. The mapping below is lifted from that
 * page's controller (tonnage-band labels, business-plan categories, sampling
 * plan files, overseas sites) and re-ordered to the literal AC02 sequence:
 *
 *   1. Site address                    6. Authority to issue
 *   2. Type                            7. Sampling and inspection plan
 *   3. Material                        8. Business plan
 *   4. PRN tonnage                     9. Broadly Equivalent Standards *
 *   5. PRN authorisers                10. Overseas Reprocessing Site *
 *
 *   * exporter applications only.
 *
 * Rows are returned as a single ordered array of siblings so the template
 * renders them in DOM order and the e2e suite can assert that order without
 * knowing how each row is composed. Each row carries a stable `key` (used
 * for its `data-testid`) and a `kind` the template switches on.
 */

export const EM_DASH = '—'

const TONNAGE_BAND_LABELS = {
  UpTo500: 'Up to 500 tonnes',
  UpTo1000: 'Up to 1,000 tonnes',
  UpTo10000: 'Up to 10,000 tonnes',
  Over10000: 'Over 10,000 tonnes'
}

const BUSINESS_PLAN_CATEGORIES = [
  { key: 'newInfrastructure', label: 'New infrastructure' },
  { key: 'priceSupport', label: 'Price support' },
  { key: 'businessCollections', label: 'Business collections' },
  { key: 'communications', label: 'Communications' },
  { key: 'newMarkets', label: 'New markets' },
  { key: 'newUses', label: 'New uses' }
]

/**
 * AC02 items 9 and 10 (BES and ORS) render for exporter applications only.
 *
 * TODO(RA-295): this is a PROXY for "the application type is Exporter", not
 * a type check — management-be carries no reprocessor/exporter discriminator
 * at all today (confirmed with the management-be owner on this story). The
 * upstream source of truth is ReEx's `wasteProcessingType`
 * ("reprocessor" | "exporter"), which the operator backend already turns into
 * `AccreditationApplicationModel.IsExporter` to gate its own BES / overseas
 * sites journey — but `HttpCaseWorkingApiAdapter.BuildPayload` never writes it
 * into the work item payload, and `typeId` is hard-coded `re-accreditation`
 * for both operator types. So there is no `payload.applicationType` /
 * `operatorType` / exporter `typeId` to read; reading one would silently never
 * match while looking like a working type check.
 *
 * The only signal that exists is whether the operator actually declared any
 * overseas reprocessing sites. `payload.overseasSites` itself is emitted
 * unconditionally (it degrades to `{ sites: [] }` for reprocessors), so the
 * test has to be on the site list being NON-EMPTY.
 *
 * THE PROXY IS WRONG IN BOTH DIRECTIONS. It is not merely imprecise:
 *
 *   - False negative — an Exporter who has NOT YET added an overseas site is
 *     indistinguishable from a Reprocessor, so BES/ORS are hidden from them,
 *     which is precisely what AC02 items 9-10 require to be shown.
 *   - False positive — a Reprocessor that DOES carry `overseasSites` gets
 *     both sections shown, which AC02 forbids.
 *
 * Hiding for a reprocessor with no sites is the common case and the required
 * default, which is why this ships — but do not read that as "correct for
 * every reprocessor".
 *
 * Replace this with the real discriminator once the payload carries one — see
 * epr-ow16 (add `isExporter` to `BuildPayload` in the operator backend plus a
 * matching property in management-be).
 *
 * When you do, the regression suite needs THREE fixtures, not one, because
 * each direction above fails independently:
 *
 *   1. Exporter WITH overseas sites      -> true positive
 *   2. Exporter WITHOUT overseas sites   -> catches the false negative
 *   3. Reprocessor WITH overseas sites   -> catches the false positive
 *
 * Fixture 2 is the one that looks redundant next to fixture 1 and will be
 * dropped by someone tidying up. Do not drop it: it is the ONLY fixture that
 * fails if a future reader decides this proxy is good enough to keep.
 *
 * Note: do NOT reach for `siteType` on an overseas site — that distinguishes
 * "ors" from "interim" sites, and is not an operator-type field.
 */
export function isExporterApplication(workItem) {
  return overseasSitesOf(workItem).length > 0
}

export function buildSiteAddressLines(payload) {
  const address = formatSiteAddress(payload)
  const postcode = getSitePostcode(payload)
  const lines = []
  if (address) lines.push(address)
  if (postcode && !(address && address.includes(postcode))) {
    lines.push(postcode)
  }
  return lines
}

function overseasSitesOf(workItem) {
  const sites = workItem?.payload?.overseasSites?.sites
  return Array.isArray(sites) ? sites : []
}

export function tonnageBandLabel(band) {
  if (!band) return EM_DASH
  return TONNAGE_BAND_LABELS[band] ?? band
}

/**
 * Flatten the business plan into ordered `{ label, value }` pairs — one pair
 * per populated category, showing the PRN-income percentage and the
 * operator's own narrative together on a single line each.
 */
export function buildBusinessPlanPairs(businessPlan) {
  const plan = businessPlan ?? {}
  return BUSINESS_PLAN_CATEGORIES.flatMap(({ key, label }) => {
    const percent = plan[`${key}Percent`]
    const detail = plan[`${key}Detail`]
    if (percent == null && !detail) return []
    return [
      {
        label,
        percent: percent == null ? null : `${percent}% of PRN income`,
        detail: detail || null
      }
    ]
  })
}

function fileViewModel(file, workItemId) {
  const scanStatus = file?.scanStatus ?? null
  const isClean = scanStatus === 'Clean'
  return {
    filename: file?.filename || EM_DASH,
    // Only a clean file is downloadable — the backend refuses the rest, and
    // offering a link that always fails is worse than showing why it is not
    // available.
    href:
      file?.fileId && isClean
        ? `/work-items/${encodeURIComponent(workItemId)}/files/${encodeURIComponent(file.fileId)}/download`
        : null,
    scanStatus: scanStatus || 'Pending',
    scanTagClass: scanTagClass(scanStatus),
    // "S&I updated by" (retained per RA-295's Jira notes) — but note the
    // producer only ever emits `uploadedAt`, never an uploader identity:
    // `BuildPayload` writes sampling-plan files as
    // `{ fileId, filename, contentType, uploadedAt, scanStatus, s3Key,
    // s3Bucket }`. So the rendered line is "Updated {date}" and the "by
    // {name}" half is unreachable today.
    //
    // The read is kept — unlike the speculative authority-to-issue reads
    // below, which were removed — because the template already renders the
    // two halves independently and an uploader name is a natural additive
    // field. TODO(epr-ow16): drop this if the producer confirms it will
    // never emit one.
    uploadedAt: file?.uploadedAt ? formatDateTimeGds(file.uploadedAt) : null,
    uploadedBy: file?.uploadedBy || null
  }
}

function scanTagClass(scanStatus) {
  if (scanStatus === 'Clean') return 'govuk-tag--green'
  if (scanStatus === 'Infected') return 'govuk-tag--red'
  return 'govuk-tag--grey'
}

export function authoriserName(authoriser) {
  return authoriser?.fullName || authoriser?.email || EM_DASH
}

/**
 * The email is shown parenthetically only when there is a NAME to put it
 * beside. A nameless authoriser has already fallen back to its email as the
 * display name (`authoriserName`), so emitting it again would render
 * "x@example.com (x@example.com)".
 */
function authoriserEmail(authoriser) {
  return authoriser?.fullName ? authoriser?.email || null : null
}

/**
 * RA-292. "Is this thing new?" — the ONE place the new-flag rule lives.
 *
 * Every RA-292 field is optional: work items that predate the story carry
 * none of them, and the producer may emit `null` for a flag it has no answer
 * for. Only an explicit `true` earns the blue "New" tag. `undefined`, `null`,
 * `false`, `0`, `''` and the string `'true'` all mean "not new".
 *
 * The string case is the one that matters: a JS truthiness test would flag
 * every site the moment a serialiser started emitting `"false"`, and the
 * failure would be invisible — a regulator would just see everything marked
 * new and have no way to tell which sites actually need scrutiny. Strict
 * equality fails closed instead: an unexpected shape shows no tag, which is
 * wrong in the safe direction and is caught by the contract fixtures.
 *
 * DO NOT add a "we don't know, so assume new to be safe" fallback here. It
 * reads as the cautious choice and is the opposite. That exact default —
 * `= true` on the producer's model — was a live defect found during RA-292:
 * the BSON deserialiser leaves a C# property initializer in place for a
 * missing element, so every site stored before the field existed came back
 * flagged, and the corrupted set was precisely the HISTORICAL case data a
 * regulator has most of. It is now server-derived and defaults to false, with
 * a test in the producer pinning that.
 *
 * A default here would recreate it a layer further out, where that test
 * cannot see it. Absent means NOT NEW, and that is a positive statement about
 * the site rather than an absence of information.
 */
export function isFlaggedNew(value) {
  return value === true
}

/**
 * RA-292. Normalise an arbitrary wire value into zero or more display lines.
 *
 * The RA-292 site fields are a grab-bag of shapes, and any of them may be
 * absent on a pre-RA-292 work item. Rather than a per-field null-check ladder
 * (thirteen of them, each its own chance to throw on a regulator's case
 * screen), every field goes through here.
 *
 * The shapes, as VERIFIED against captured producer output rather than
 * inferred from the field names — several of them read as one type and
 * serialise as another:
 *
 *   - `coordinates` and `repatriatedLoads` are STRINGS ("48.8566,2.3522",
 *     "12"), not a lat/long pair and not a number.
 *   - `conditionsOfExport` is a nullable BOOLEAN (`bool?` on
 *     `AccreditationApplicationOverseasSites`), NOT free text — so it renders
 *     "Yes"/"No". An earlier revision of this comment called it a string
 *     array; that was wrong, and the same mistake had already been seeded as
 *     prose in management-be, so it cost a correction cycle across three
 *     repos. If you are about to describe a field's type here, check the
 *     producer's model first.
 *   - `isEu`, `isOecd`, `registeredNowAccredited` are booleans.
 *   - Everything else is a string.
 *
 * The array branch below is NOT for any of those — it exists for genuinely
 * repeating fields, and is what keeps this helper usable for the next one
 * that arrives. Nothing in the current ORS or interim shape is an array.
 *
 * Returning an ARRAY rather than a string-or-null is what lets the caller
 * drop empty fields entirely: a detail row with no lines is not rendered, so
 * the page shows the data that exists instead of a column of em-dashes. The
 * em-dash fallback is kept for the things that must always be on the page —
 * the site name and an empty site/contact list — where silence would read as
 * "no site" rather than "no value".
 *
 * Booleans deliberately render "Yes"/"No" rather than being dropped when
 * false: `isEu: false` is a substantive answer a regulator needs, unlike an
 * absent field. Only the new-flags use strict-true-or-nothing.
 */
export function toDisplayLines(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.flatMap(toDisplayLines)
  if (typeof value === 'boolean') return [value ? 'Yes' : 'No']
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [String(value)] : []
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? [] : [trimmed]
  }
  // Objects we have no mapping for contribute nothing rather than rendering
  // "[object Object]" onto a case screen.
  return []
}

function firstLineOr(value, fallback) {
  return toDisplayLines(value)[0] ?? fallback
}

/** The three Basel/OECD waste codes read as one comma-separated line. */
function wasteCodeLines(site) {
  const codes = [site.code1, site.code2, site.code3].flatMap(toDisplayLines)
  return codes.length > 0 ? [codes.join(', ')] : []
}

/**
 * An overseas site's address, from whichever of the two overlapping shapes it
 * actually arrived in.
 *
 * `siteAddress` is the legacy single-line form; `addressLine1` / `2` +
 * `townOrCity` is the structured form RA-292 added. A site may carry both,
 * one, or a PARTIAL structured form — which is the case that makes a plain
 * "structured wins if non-empty" rule wrong. A site with only `townOrCity`
 * and a flat `siteAddress` would render as the bare town, silently dropping
 * the street from a regulator's review of the site.
 *
 * So `addressLine1` is the test, not emptiness: it is what makes the
 * structured fields a whole address. Without it the flat string leads and any
 * structured field it does not already repeat is appended, so nothing is
 * lost either way and the address is never printed twice.
 *
 * The de-duplication compares whole comma-separated SEGMENTS of the flat
 * string, not substrings. A substring test drops a structured value that
 * merely appears inside the flat one — `townOrCity: "York"` against
 * `"New York Road"` would lose the town from the site's address entirely,
 * which is the same silent data loss this function exists to prevent.
 */
function addressSegments(lines) {
  return lines
    .flatMap((line) => line.split(','))
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment !== '')
}

function overseasSiteAddressLines(site) {
  const structured = [
    site.addressLine1,
    site.addressLine2,
    site.townOrCity
  ].flatMap(toDisplayLines)

  if (toDisplayLines(site.addressLine1).length > 0) return structured

  const flat = toDisplayLines(site.siteAddress)
  if (flat.length === 0) return structured

  const segments = addressSegments(flat)
  return [
    ...flat,
    ...structured.filter(
      (line) => !segments.includes(line.trim().toLowerCase())
    )
  ]
}

/**
 * The interim site has no legacy flat-string form — it only ever arrives
 * structured — so this is a straight concatenation of the populated parts.
 */
function interimSiteAddressLines(site) {
  return [
    site.addressLine1,
    site.addressLine2,
    site.townOrCity,
    site.stateOrRegion,
    site.postcode
  ].flatMap(toDisplayLines)
}

/**
 * AC04. The ORS detail a regulator needs to review the site, in reading
 * order: what it is, where it is, who to contact, what it is permitted to do.
 *
 * Declared as data rather than built inline so the field list, its labels and
 * its `data-testid` keys read in one place — the e2e suite pins these keys,
 * so a rename here is a contract change.
 */
const ORS_DETAIL_FIELDS = [
  ['ors-id', 'ORS ID', (site) => toDisplayLines(site.orsId)],
  ['address', 'Address', overseasSiteAddressLines],
  // A pre-formatted string ("48.8566,2.3522"), NOT a {lat,long} pair —
  // confirmed against a captured payload by the producer, who pins it with an
  // exact-JSON test. An earlier revision also handled the object shape; it was
  // removed once confirmed dead, for the reason spelled out on
  // `isExporterApplication` above — a branch that can never fire still reads
  // as a working feature to the next person.
  ['coordinates', 'Coordinates', (site) => toDisplayLines(site.coordinates)],
  ['contact-name', 'Contact name', (site) => toDisplayLines(site.contactName)],
  [
    'contact-email',
    'Contact email',
    (site) => toDisplayLines(site.contactEmail)
  ],
  [
    'contact-phone',
    'Contact phone',
    (site) => toDisplayLines(site.contactPhone)
  ],
  [
    'operation-code',
    'Operation code',
    (site) => toDisplayLines(site.operationCode)
  ],
  ['waste-codes', 'Basel/OECD codes', wasteCodeLines],
  [
    'repatriated-loads',
    'Repatriated loads',
    (site) => toDisplayLines(site.repatriatedLoads)
  ],
  [
    'conditions-of-export',
    'Conditions of export',
    (site) => toDisplayLines(site.conditionsOfExport)
  ],
  [
    'registered-now-accredited',
    'Registered, now seeking accreditation',
    (site) => toDisplayLines(site.registeredNowAccredited)
  ],
  ['eu-country', 'EU country', (site) => toDisplayLines(site.isEu)],
  ['oecd-country', 'OECD country', (site) => toDisplayLines(site.isOecd)]
]

/**
 * AC04, interim half. A shorter list than the ORS one because the interim
 * site carries no operation/waste codes — it is a staging point, not a
 * reprocessor. It does carry `stateOrRegion` and `postcode`, which the ORS
 * shape does not.
 */
const INTERIM_DETAIL_FIELDS = [
  ['site-number', 'Site number', (site) => toDisplayLines(site.siteNumber)],
  ['address', 'Address', interimSiteAddressLines],
  ['contact-name', 'Contact name', (site) => toDisplayLines(site.contactName)],
  [
    'contact-email',
    'Contact email',
    (site) => toDisplayLines(site.contactEmail)
  ],
  [
    'contact-phone',
    'Contact phone',
    (site) => toDisplayLines(site.contactPhone)
  ]
]

function buildDetails(fields, site) {
  return fields.flatMap(([key, label, read]) => {
    const values = read(site)
    return values.length > 0 ? [{ key, label, values }] : []
  })
}

/**
 * RA-292 AC02 + AC04. An interim site is a CHILD of an overseas site — at
 * most one per ORS — not a peer, so it is built here and nested inside the
 * ORS view model rather than becoming a row of its own.
 *
 * An ORS with no interim site OMITS the key entirely rather than sending
 * null: the producer serialises with `DefaultIgnoreCondition =
 * WhenWritingNull`, so in practice a literal null never arrives. The `== null`
 * test covers both anyway, because "absent" and "null" must not be allowed to
 * diverge into two behaviours here.
 *
 * @returns {object|null} null when the ORS has no interim site.
 */
export function buildInterimSite(site) {
  if (site == null || typeof site !== 'object') return null
  return {
    siteName: firstLineOr(site.siteName, EM_DASH),
    country: firstLineOr(site.country, null),
    isNew: isFlaggedNew(site.isNewSite),
    details: buildDetails(INTERIM_DETAIL_FIELDS, site)
  }
}

/** RA-292 AC01 + AC04. One overseas site with its detail and interim child. */
export function buildOverseasSite(site) {
  const source = site ?? {}
  return {
    siteName: firstLineOr(source.siteName, EM_DASH),
    country: firstLineOr(source.country, null),
    isNew: isFlaggedNew(source.isNewSite),
    details: buildDetails(ORS_DETAIL_FIELDS, source),
    interimSite: buildInterimSite(source.interimSite)
  }
}

/**
 * Resolve "Authority to issue" (AC02 item 6, RA-292 AC03).
 *
 * TODO(epr-ow16): there is no separate authority-to-issue field on the wire.
 * `HttpCaseWorkingApiAdapter.BuildPayload` emits `prns` as exactly
 * `{ plannedTonnageBand, authorisers[] }`, so the PRN authorisers ARE the
 * people holding authority to issue, and AC02's items 5 and 6 necessarily
 * show the same people — item 5 by name, item 6 with contact detail.
 *
 * An earlier revision speculatively read `prns.authorityToIssue` /
 * `payload.authorityToIssue` first. Both are dead on every real payload, and
 * an unreachable branch that looks like a working feature is precisely what
 * the `isExporterApplication` comment above warns against — so the
 * speculative reads are gone. Add one back when the producer actually emits
 * the field, with a contract-fixture update proving it.
 *
 * RA-292 AC03 adds `isNew` per authoriser, so the row now carries a view
 * model per contact instead of a flat string — the "New" tag has to attach to
 * an individual contact, which a plain line cannot express. Name and email
 * are kept apart so the name gets its own e2e hook, but the rendered text is
 * unchanged ("Name (email)"), so nothing downstream that reads the row's text
 * is affected.
 */
export function buildAuthorityToIssueContacts(prns) {
  const authorisers = Array.isArray(prns?.authorisers) ? prns.authorisers : []
  return authorisers.map((authoriser) => ({
    name: authoriserName(authoriser),
    email: authoriserEmail(authoriser),
    isNew: isFlaggedNew(authoriser?.isNew)
  }))
}

/**
 * Build the AC02-ordered application information rows.
 *
 * @param {object} args
 * @param {object} args.workItem decorated work item
 * @returns {{ rows: object[], isExporter: boolean }}
 */
export function buildApplicationSummary({ workItem }) {
  const payload = workItem?.payload ?? {}
  const workItemId = workItem?.id ?? ''
  const prns = payload.prns ?? {}
  const isExporter = isExporterApplication(workItem)

  const authorisers = Array.isArray(prns.authorisers) ? prns.authorisers : []
  const samplingFiles = Array.isArray(payload.samplingPlan?.files)
    ? payload.samplingPlan.files
    : []
  const overseasSites = overseasSitesOf(workItem)

  const rows = [
    {
      key: 'site-address',
      label: 'Site address',
      kind: 'lines',
      // RA-245. The address arrives either nested (postcode inside the
      // object, excluded from `formatSiteAddress`) or as a legacy flat
      // string that already contains the postcode — so the postcode is added
      // as a second line only when it is not already part of the first.
      values: buildSiteAddressLines(payload)
    },
    {
      key: 'type',
      label: 'Type',
      kind: 'text',
      // Sourced from the registry, so no type-specific wording is hard-coded
      // into this generic route.
      //
      // Deliberately NOT prefixed with an applicant kind ("Reprocessor" /
      // "Exporter"). The `overseasSites` proxy below is only safe in one
      // direction: hiding BES/ORS when the signal is missing is a
      // conservative default, whereas PRINTING "Reprocessor" is a positive
      // factual claim — and by that proxy's own logic an exporter who has
      // not yet added a site would be labelled a Reprocessor on a
      // regulator's case screen. Restore the prefix only once a real
      // discriminator reaches the payload (epr-ow16).
      value: workItem?.typeDisplayName || workItem?.typeId || EM_DASH
    },
    {
      key: 'material',
      label: 'Material',
      kind: 'text',
      value: payload.material ? materialLabel(payload.material) : EM_DASH
    },
    {
      key: 'prn-tonnage',
      label: 'PRN tonnage',
      kind: 'text',
      value: tonnageBandLabel(prns.plannedTonnageBand)
    },
    {
      key: 'prn-authorisers',
      label: 'PRN authorisers',
      kind: 'lines',
      values: authorisers.map(authoriserName)
    },
    {
      key: 'authority-to-issue',
      label: 'Authority to issue',
      // RA-292 AC03: `authority-contacts`, not `lines`, because the "New" tag
      // has to attach to an INDIVIDUAL contact. The rendered text per contact
      // is unchanged.
      kind: 'authority-contacts',
      contacts: buildAuthorityToIssueContacts(prns)
    },
    {
      key: 'sampling-inspection-plan',
      label: 'Sampling and inspection plan',
      kind: 'files',
      // AC02 item 7: every supporting document is listed, not just the first.
      files: samplingFiles.map((file) => fileViewModel(file, workItemId))
    },
    {
      key: 'business-plan',
      label: 'Business plan',
      kind: 'pairs',
      pairs: buildBusinessPlanPairs(payload.businessPlan)
    }
  ]

  if (isExporter) {
    rows.push(
      {
        key: 'bes',
        label: 'Broadly Equivalent Standards (BES)',
        // RA-292 renamed this kind from the generic `sites`. It is now the
        // BES row's alone: the ORS row moved to `overseas-sites` to carry the
        // full site detail, and leaving both on one kind meant both emitted
        // `data-testid="overseas-site"` — so a per-site e2e lookup matched
        // 2N blocks and could not tell an ORS from its BES evidence.
        kind: 'bes-sites',
        sites: overseasSites.map((site) => ({
          siteName: site?.siteName || EM_DASH,
          country: site?.country || null,
          files: (Array.isArray(site?.besEvidence?.files)
            ? site.besEvidence.files
            : []
          ).map((file) => fileViewModel(file, workItemId))
        }))
      },
      {
        key: 'ors',
        label: 'Overseas Reprocessing Site (ORS)',
        // RA-292 AC01/AC02/AC04. Carries the new-site flag, the full site
        // detail and the nested interim site.
        kind: 'overseas-sites',
        sites: overseasSites.map((site) => buildOverseasSite(site))
      }
    )
  }

  return { rows, isExporter }
}

/**
 * The debugging / provenance block that RA-295 keeps but moves to the bottom
 * of the page: the application reference and work item id, plus the envelope
 * and operator-reference fields that used to live on the standalone
 * application-details page, so folding that page in loses no data.
 */
export function buildCaseFooterRows({ workItem }) {
  const payload = workItem?.payload ?? {}
  const submittedBy = payload.submittedBy ?? {}
  const declaration =
    submittedBy.fullName || submittedBy.jobTitle || submittedBy.email
      ? [submittedBy.fullName, submittedBy.jobTitle, submittedBy.email]
          .filter(Boolean)
          .join(', ')
      : null

  const candidates = [
    [
      'application-reference',
      'Application reference',
      payload.applicationReference
    ],
    ['work-item-id', 'Work item ID', workItem?.id],
    ['registration-number', 'Registration number', payload.registrationNumber],
    ['accreditation-year', 'Accreditation year', payload.accreditationYear],
    [
      'previous-accreditation-year',
      'Previous accreditation year',
      payload.previousAccreditationYear
    ],
    [
      'compliance-issues-reported',
      'Compliance issues reported',
      payload.complianceIssuesReported
    ],
    [
      'operator-application-id',
      'Operator application ID',
      payload.operatorApplicationId
    ],
    [
      'operator-organisation-id',
      'Operator organisation ID',
      payload.operatorOrganisationId
    ],
    [
      'operator-registration-id',
      'Operator registration ID',
      payload.operatorRegistrationId
    ],
    ['operator-email', 'Operator email', payload.operatorEmail],
    ['declaration', 'Declaration', declaration],
    ['submitted-by', 'Submitted by', workItem?.submittedBy],
    [
      'submitted-at',
      'Submitted at',
      workItem?.submittedAt ? formatDateTimeGds(workItem.submittedAt) : null
    ],
    [
      'last-modified',
      'Last modified',
      workItem?.lastModifiedAt
        ? formatDateTimeGds(workItem.lastModifiedAt)
        : null
    ]
  ]

  return candidates
    .filter(([, , value]) => value != null && value !== '')
    .map(([key, label, value]) => ({ key, label, value: String(value) }))
}
