import { getWorkItems } from '#/server/common/helpers/backend-api/backend-api.js'
import {
  getWorkItemType,
  getWorkItemTypes
} from '#/server/work-items/core/registry.js'

const DEFAULT_PAGE_SIZE = 20

/**
 * Renders the cross-type work item list, with filter, search and pagination.
 *
 * Filters and pagination are read from the query string, validated against
 * the registered modules (so unknown values are silently dropped) and
 * forwarded to the backend. The view is GOV.UK Design system only and works
 * without JavaScript: every filter and page link is a plain `<form>` /
 * `<a>`-driven request.
 */
export const workItemListController = {
  async handler(request, h) {
    const filters = readFilters(request.query)

    const result = await getWorkItems({
      typeIds: filters.typeIds,
      stateIds: filters.stateIds,
      search: filters.search,
      page: filters.page,
      pageSize: DEFAULT_PAGE_SIZE
    })

    const items = result.ok ? result.items.map((item) => decorate(item)) : []

    const totalCount = result.ok ? result.totalCount : 0
    const page = result.ok ? result.page : filters.page
    const pageSize = result.ok ? result.pageSize : DEFAULT_PAGE_SIZE
    const totalPages =
      pageSize > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1

    return h.view('work-items/index', {
      pageTitle: 'Work items',
      heading: 'Work items',
      breadcrumbs: [
        { text: 'Home', href: '/' },
        { text: 'Work items' }
      ],
      ok: result.ok,
      error: result.error,
      items,
      filters,
      typeOptions: buildTypeOptions(filters.typeIds),
      stateOptions: buildStateOptions(filters.stateIds),
      totalCount,
      page,
      pageSize,
      totalPages,
      pagination: buildPagination({ page, totalPages, filters }),
      filterSummary: buildFilterSummary({ filters, totalCount }),
      hasFilters:
        filters.typeIds.length > 0 ||
        filters.stateIds.length > 0 ||
        filters.search !== ''
    })
  }
}

function readFilters(query) {
  const typeIds = uniqueStringList(query.typeId).filter(
    (id) => getWorkItemType(id) !== null
  )

  const knownStateIds = new Set(
    getWorkItemTypes().flatMap((type) =>
      (type.states ?? []).map((state) => state.id)
    )
  )
  const stateIds = uniqueStringList(query.stateId).filter((id) =>
    knownStateIds.has(id)
  )

  const search =
    typeof query.search === 'string' ? query.search.trim() : ''

  const page = clampPositiveInt(query.page, 1)

  return { typeIds, stateIds, search, page }
}

function uniqueStringList(value) {
  if (value == null) return []
  const list = Array.isArray(value) ? value : [value]
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback
}

function decorate(item) {
  const type = getWorkItemType(item.typeId)
  const stateId = item.stateId
  const stateDisplayName =
    type?.states?.find((state) => state.id === stateId)?.displayName ?? stateId
  return {
    ...item,
    typeDisplayName: type?.displayName ?? item.typeId,
    stateDisplayName
  }
}

function buildTypeOptions(selectedTypeIds) {
  const selected = new Set(selectedTypeIds)
  return getWorkItemTypes().map((type) => ({
    value: type.id,
    text: type.displayName,
    checked: selected.has(type.id)
  }))
}

function buildStateOptions(selectedStateIds) {
  const selected = new Set(selectedStateIds)
  // Deduplicate states across all registered types by id, preserving the
  // first-encountered display name.
  const seen = new Map()
  for (const type of getWorkItemTypes()) {
    for (const state of type.states ?? []) {
      if (!seen.has(state.id)) {
        seen.set(state.id, state.displayName)
      }
    }
  }
  return Array.from(seen.entries()).map(([id, displayName]) => ({
    value: id,
    text: displayName,
    checked: selected.has(id)
  }))
}

/**
 * Build a govuk-pagination compatible structure. Hidden when there is only
 * one page. Each href preserves the active filters.
 */
function buildPagination({ page, totalPages, filters }) {
  if (totalPages <= 1) return null

  const makeHref = (target) => buildHref({ ...filters, page: target })

  const items = []
  for (let i = 1; i <= totalPages; i++) {
    items.push({
      number: i,
      href: makeHref(i),
      current: i === page
    })
  }

  return {
    previous: page > 1 ? { href: makeHref(page - 1) } : null,
    next: page < totalPages ? { href: makeHref(page + 1) } : null,
    items
  }
}

function buildHref(filters) {
  const params = new URLSearchParams()
  for (const id of filters.typeIds ?? []) params.append('typeId', id)
  for (const id of filters.stateIds ?? []) params.append('stateId', id)
  if (filters.search) params.append('search', filters.search)
  if (filters.page && filters.page > 1) {
    params.append('page', String(filters.page))
  }
  const qs = params.toString()
  return qs === '' ? '/work-items' : `/work-items?${qs}`
}

function buildFilterSummary({ filters, totalCount }) {
  const parts = []
  if (filters.typeIds.length > 0) {
    const names = filters.typeIds.map(
      (id) => getWorkItemType(id)?.displayName ?? id
    )
    parts.push(`type: ${names.join(', ')}`)
  }
  if (filters.stateIds.length > 0) {
    parts.push(`state: ${filters.stateIds.join(', ')}`)
  }
  if (filters.search) {
    parts.push(`search: "${filters.search}"`)
  }
  return {
    totalCount,
    description: parts.length === 0 ? null : parts.join(' · ')
  }
}
