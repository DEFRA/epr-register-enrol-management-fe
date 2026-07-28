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
 * test has to be on the site list being NON-EMPTY. That hides both sections
 * for every reprocessor, which is the required default.
 *
 * Replace this with the real discriminator once the payload carries one — see
 * the follow-up to add `isExporter` to `BuildPayload` in the operator backend
 * plus a matching property in management-be.
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

function authoriserLine(authoriser) {
  const name = authoriser?.fullName || null
  const email = authoriser?.email || null
  if (name && email) return `${name} (${email})`
  return name || email || EM_DASH
}

/**
 * Resolve "Authority to issue" (AC02 item 6).
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
 */
function buildAuthorityToIssue(prns) {
  const authorisers = Array.isArray(prns?.authorisers) ? prns.authorisers : []
  return authorisers.map(authoriserLine)
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
      kind: 'lines',
      values: buildAuthorityToIssue(prns)
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
        kind: 'sites',
        sites: overseasSites.map((site) => ({
          siteName: site?.siteName || EM_DASH,
          country: site?.country || null,
          siteAddress: null,
          files: (Array.isArray(site?.besEvidence?.files)
            ? site.besEvidence.files
            : []
          ).map((file) => fileViewModel(file, workItemId))
        }))
      },
      {
        key: 'ors',
        label: 'Overseas Reprocessing Site (ORS)',
        kind: 'sites',
        sites: overseasSites.map((site) => ({
          siteName: site?.siteName || EM_DASH,
          country: site?.country || null,
          siteAddress: site?.siteAddress || null,
          files: []
        }))
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
