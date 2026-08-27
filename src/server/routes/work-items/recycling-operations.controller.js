/**
 * Recycling operations tab controller (RA-469).
 *
 * `GET /work-items/{id}/recycling-operations` — lists each overseas
 * reprocessing site's recycling operation codes for the application, so a
 * regulator can review and (via the edit form, RA-469 8pi) correct them.
 * Structurally mirrors `audit-log.controller.js`: re-fetch the work item via
 * the backend client, build the shared case header/tabs, render a single
 * two-thirds-column standalone tab page (RA-295) with no JavaScript (RA-94).
 */

import { formatDateTimeGds } from '#/config/nunjucks/filters/format-date.js'
import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { buildCaseHeader, buildCaseTabs } from './case-header.js'
import { renderWorkItemFetchError } from './work-item-fetch-errors.js'
import { recyclingOperationLabel } from './recycling-operations.schema.js'
import { overseasSitesOf } from './overseas-sites.js'

const VIEW = 'work-items/recycling-operations'
const EM_DASH = '—'

/**
 * GDS's typical default for a list of compound/multi-line items (per the
 * ticket's "The list itself, at 2-200 sites" section) — one single
 * threshold shared by both the search-box and pagination decisions, rather
 * than two separate arbitrary cut-offs.
 */
const PAGE_SIZE = 20

/**
 * An overseas site's associated interim site has no legacy flat-address
 * form (see `application-summary.js`'s `interimSiteAddressLines`) — it only
 * ever arrives structured — so this is a straight concatenation of the
 * populated parts, one comma-joined line, for the plain-text summary the
 * Recycling operations row shows (not the full labelled detail list the
 * Application summary tab renders).
 */
function interimSiteAddressLine(interimSite) {
  const parts = [
    interimSite?.addressLine1,
    interimSite?.addressLine2,
    interimSite?.townOrCity,
    interimSite?.stateOrRegion,
    interimSite?.postcode,
    interimSite?.country
  ].filter((part) => typeof part === 'string' && part.trim() !== '')
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * RA-469 AC15/AC19 write a new edit-specific audit record when a
 * regulator's change lands. Until that record is surfaced back onto the
 * site (the field name is not yet finalised on the backend side, built by
 * a sibling team in parallel), the "last edited" line is read from these
 * two optional fields and simply omitted when absent — the same
 * omit-unless-present convention `application-summary.js` uses throughout
 * for RA-292 fields a pre-feature work item never carries.
 */
function lastEditedOf(site) {
  const by = site?.recyclingOperationsUpdatedBy
  const at = site?.recyclingOperationsUpdatedAt
  if (!by && !at) {
    return null
  }
  return {
    by: by || null,
    at: at ? formatDateTimeGds(at) : null
  }
}

/**
 * AC6: the interim site's name is shown only when the site carries R12 or
 * R13 — those two codes are the only ones that describe an operation
 * performed in relation to an associated interim site (see
 * `recycling-operations.schema.js`'s `CODES_REQUIRING_ACCOMPANIMENT`).
 */
function hasAccompanimentCode(codes) {
  return codes.some((code) => code === 'R12' || code === 'R13')
}

/** One overseas site's Recycling operations row view model. */
export function buildRecyclingOperationsSite(site, workItemId) {
  const codes = Array.isArray(site?.operationCodes) ? site.operationCodes : []
  const showInterimSite = hasAccompanimentCode(codes) && site?.interimSite

  return {
    siteId: site?.siteId ?? null,
    siteName: site?.siteName || EM_DASH,
    codes,
    // AC6: full human-readable label text, not the bare code.
    codeLabels: codes.map(recyclingOperationLabel),
    // AC7: a site with zero codes states this clearly rather than
    // rendering an empty list — the template branches on this flag.
    hasCodes: codes.length > 0,
    interimSite: showInterimSite
      ? {
          siteName: site.interimSite.siteName || EM_DASH,
          addressLine: interimSiteAddressLine(site.interimSite)
        }
      : null,
    lastEdited: lastEditedOf(site),
    // RA-469 8pi's task explicitly names the edit route
    // `/work-items/{id}/recycling-operations/{siteId}` (GET+POST) — no
    // `/edit` suffix, unlike the sla/query GET-interstitial routes.
    editHref:
      site?.siteId != null
        ? `/work-items/${encodeURIComponent(workItemId)}/recycling-operations/${encodeURIComponent(site.siteId)}`
        : null
  }
}

/**
 * AC2: overseas sites are ALWAYS sorted alphabetically by site name,
 * regardless of the order the backend returns them in — a stable, never
 * user-configurable default (see the ticket's "The list itself" section).
 */
export function buildRecyclingOperationsSites(workItem) {
  return overseasSitesOf(workItem)
    .map((site) => buildRecyclingOperationsSite(site, workItem?.id))
    .sort((a, b) =>
      a.siteName.localeCompare(b.siteName, 'en', { sensitivity: 'base' })
    )
}

/**
 * Same one-shot read-and-clear semantics as `detail.controller.js`'s
 * `flashBanner` read — `request.yar.flash(name)` returns every value
 * flashed under that key and clears it; the first entry is kept (AC13
 * flashes once per redirect) and any extra is ignored for forward-compat.
 */
export function readFlashBanner(request) {
  const flashed = request.yar?.flash?.('flashBanner') ?? []
  return Array.isArray(flashed) && flashed.length > 0 ? flashed[0] : null
}

/**
 * AC4: case-insensitive SUBSTRING match on site name. `search` is already
 * trimmed by the caller; an empty string matches everything (no filter
 * applied) rather than nothing.
 */
export function filterRecyclingOperationsSites(sites, search) {
  const term = (search ?? '').toLowerCase()
  if (term === '') {
    return sites
  }
  return sites.filter((site) => site.siteName.toLowerCase().includes(term))
}

/**
 * A govuk-pagination compatible structure, modelled on `controller.js`'s
 * `buildPagination`/`buildHref` for the work-items list. Hidden when there
 * is only one page (AC5: renders only when the current search's matching
 * sites exceed one page). Every href preserves `q=`; the page-1 link
 * omits `page=` entirely so the "no explicit page" and "page=1" URLs are
 * the same canonical link.
 */
function buildPaginationHref(basePath, { q, page }) {
  const params = new URLSearchParams()
  if (q) {
    params.append('q', q)
  }
  if (page > 1) {
    params.append('page', String(page))
  }
  const qs = params.toString()
  return qs === '' ? basePath : `${basePath}?${qs}`
}

function buildRecyclingOperationsPagination({ basePath, q, page, totalPages }) {
  if (totalPages <= 1) {
    return null
  }

  const makeHref = (target) =>
    buildPaginationHref(basePath, { q, page: target })
  const items = []
  for (let i = 1; i <= totalPages; i++) {
    items.push({ number: i, href: makeHref(i), current: i === page })
  }

  return {
    previous: page > 1 ? { href: makeHref(page - 1) } : null,
    next: page < totalPages ? { href: makeHref(page + 1) } : null,
    items
  }
}

/**
 * Resolve the requested page number against the real page count: a
 * missing, non-numeric, zero/negative, or out-of-range value defaults to
 * page 1 rather than erroring — a stale bookmark or a hand-edited URL must
 * still render a page, not a 400/500. This is also what gives AC4's "page
 * resets to 1 on a new search" for free: the search form itself never
 * submits a `page=` field, so a fresh search always arrives with `page`
 * absent.
 */
function resolvePage(rawPage, totalPages) {
  const requested = Number.parseInt(rawPage, 10)
  return Number.isInteger(requested) &&
    requested >= 1 &&
    requested <= totalPages
    ? requested
    : 1
}

export const workItemRecyclingOperationsController = {
  async handler(request, h) {
    const id = request.params.id
    const user = getUser(request)
    const result = await getWorkItem({ workItemId: id, user })

    const errorResponse = renderWorkItemFetchError({ h, result, id })
    if (errorResponse) {
      return errorResponse
    }

    const workItem = result.workItem
    const applicationRef = workItem.payload?.applicationReference ?? null
    const type = getWorkItemType(workItem.typeId)
    const stateDisplayName =
      type?.states?.find((s) => s.id === workItem.stateId)?.displayName ??
      workItem.stateId

    const allSites = buildRecyclingOperationsSites(workItem)
    const searchTerm =
      typeof request.query?.q === 'string' ? request.query.q.trim() : ''
    const matchingSites = filterRecyclingOperationsSites(allSites, searchTerm)

    const totalPages = Math.max(1, Math.ceil(matchingSites.length / PAGE_SIZE))
    const page = resolvePage(request.query?.page, totalPages)
    const pageSites = matchingSites.slice(
      (page - 1) * PAGE_SIZE,
      page * PAGE_SIZE
    )

    const basePath = `/work-items/${encodeURIComponent(workItem.id)}/recycling-operations`

    return h.view(VIEW, {
      pageTitle: `Recycling operations — ${applicationRef}`,
      caseHeader: buildCaseHeader({
        workItem: {
          ...workItem,
          stateDisplayName,
          stateTagClass: stateTagClass(workItem.stateId)
        }
      }),
      caseTabs: buildCaseTabs({
        workItemId: workItem.id,
        active: 'recycling-operations'
      }),
      workItem: { id: workItem.id, applicationRef },
      sites: pageSites,
      // AC3: the search box's own presence is keyed on the TOTAL site
      // count, not the current search's match count — it must not
      // disappear the moment a search narrows the list below 20.
      showSearch: allSites.length > PAGE_SIZE,
      searchTerm,
      searchFormAction: basePath,
      pagination: buildRecyclingOperationsPagination({
        basePath,
        q: searchTerm,
        page,
        totalPages
      }),
      flashBanner: readFlashBanner(request)
    })
  }
}
