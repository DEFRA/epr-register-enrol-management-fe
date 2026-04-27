import { getWorkItems } from '#/server/common/helpers/backend-api/backend-api.js'
import {
  getWorkItemType,
  getWorkItemTypes
} from '#/server/work-items/core/registry.js'
import { getAssignableUsers } from '#/server/work-items/core/assignees.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'

const DEFAULT_PAGE_SIZE = 20

const ASSIGNEE_FILTER_ANY = 'any'
const ASSIGNEE_FILTER_MINE = 'mine'
const ASSIGNEE_FILTER_UNASSIGNED = 'unassigned'
const ASSIGNEE_FILTER_USER = 'user'

/**
 * Renders the cross-type work item list, with filter, search and pagination.
 *
 * Filters and pagination are read from the query string, validated against
 * the registered modules (so unknown values are silently dropped) and
 * forwarded to the backend. The view is GOV.UK Design system only and works
 * without JavaScript: every filter and page link is a plain `<form>` /
 * `<a>`-driven request.
 *
 * Assignee filter (RA-95): the user can narrow the list to "mine"
 * (currently signed-in user), "unassigned", or a specific user picked from
 * the assignable-users directory. Standard users see exactly the same
 * filter set; only the destructive *assign* writes are gated by role.
 */
export const workItemListController = {
  async handler(request, h) {
    const user = getUser(request)
    const filters = readFilters(request.query, user)

    const result = await getWorkItems({
      typeIds: filters.typeIds,
      stateIds: filters.stateIds,
      search: filters.search,
      assigneeId: filters.backendAssigneeId,
      unassigned: filters.backendUnassignedOnly,
      page: filters.page,
      pageSize: DEFAULT_PAGE_SIZE,
      user
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
      assigneeFilterOptions: buildAssigneeFilterOptions(filters, user),
      assigneeUserOptions: buildAssigneeUserOptions(filters.assigneeUserId),
      totalCount,
      page,
      pageSize,
      totalPages,
      pagination: buildPagination({ page, totalPages, filters }),
      filterSummary: buildFilterSummary({ filters, totalCount }),
      hasFilters:
        filters.typeIds.length > 0 ||
        filters.stateIds.length > 0 ||
        filters.search !== '' ||
        filters.assigneeMode !== ASSIGNEE_FILTER_ANY
    })
  }
}

function readFilters(query, user) {
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

  const assigneeMode = normaliseAssigneeMode(query.assigneeMode)
  const assigneeUserId =
    typeof query.assigneeUserId === 'string' && query.assigneeUserId.trim() !== ''
      ? query.assigneeUserId.trim()
      : null

  // Translate the UI-facing assignee filter into the backend's
  // (assigneeId, unassignedOnly) shape. "Mine" needs a logged-in user; if
  // somehow we don't have one, treat it as no filter rather than crashing.
  let backendAssigneeId = null
  let backendUnassignedOnly = false
  if (assigneeMode === ASSIGNEE_FILTER_MINE && user?.id) {
    backendAssigneeId = user.id
  } else if (assigneeMode === ASSIGNEE_FILTER_UNASSIGNED) {
    backendUnassignedOnly = true
  } else if (assigneeMode === ASSIGNEE_FILTER_USER && assigneeUserId) {
    backendAssigneeId = assigneeUserId
  }

  return {
    typeIds,
    stateIds,
    search,
    page,
    assigneeMode,
    assigneeUserId,
    backendAssigneeId,
    backendUnassignedOnly
  }
}

function normaliseAssigneeMode(value) {
  if (
    value === ASSIGNEE_FILTER_MINE ||
    value === ASSIGNEE_FILTER_UNASSIGNED ||
    value === ASSIGNEE_FILTER_USER
  ) {
    return value
  }
  return ASSIGNEE_FILTER_ANY
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
    stateDisplayName,
    assigneeDisplayName: item.assignedToName ?? item.assignedToId ?? null
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

function buildAssigneeFilterOptions(filters, user) {
  // The radio options the user picks between. "Mine" is only meaningful
  // for an authenticated user, but we always include it so the same
  // template works regardless.
  const options = [
    {
      value: ASSIGNEE_FILTER_ANY,
      text: 'Anyone',
      checked: filters.assigneeMode === ASSIGNEE_FILTER_ANY
    },
    {
      value: ASSIGNEE_FILTER_MINE,
      text: user?.name
        ? `Assigned to me (${user.name})`
        : 'Assigned to me',
      checked: filters.assigneeMode === ASSIGNEE_FILTER_MINE
    },
    {
      value: ASSIGNEE_FILTER_UNASSIGNED,
      text: 'Unassigned',
      checked: filters.assigneeMode === ASSIGNEE_FILTER_UNASSIGNED
    },
    {
      value: ASSIGNEE_FILTER_USER,
      text: 'Specific user…',
      checked: filters.assigneeMode === ASSIGNEE_FILTER_USER,
      conditional: { html: '__assignee-user-select__' }
    }
  ]
  return options
}

function buildAssigneeUserOptions(selectedUserId) {
  const items = [
    { value: '', text: 'Select a user', selected: !selectedUserId }
  ]
  for (const u of getAssignableUsers()) {
    items.push({
      value: u.id,
      text: u.name ?? u.id,
      selected: u.id === selectedUserId
    })
  }
  return items
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
  if (filters.assigneeMode && filters.assigneeMode !== ASSIGNEE_FILTER_ANY) {
    params.append('assigneeMode', filters.assigneeMode)
    if (filters.assigneeMode === ASSIGNEE_FILTER_USER && filters.assigneeUserId) {
      params.append('assigneeUserId', filters.assigneeUserId)
    }
  }
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
  if (filters.assigneeMode === ASSIGNEE_FILTER_MINE) {
    parts.push('assigned to me')
  } else if (filters.assigneeMode === ASSIGNEE_FILTER_UNASSIGNED) {
    parts.push('unassigned')
  } else if (filters.assigneeMode === ASSIGNEE_FILTER_USER && filters.assigneeUserId) {
    parts.push(`assignee: ${filters.assigneeUserId}`)
  }
  return {
    totalCount,
    description: parts.length === 0 ? null : parts.join(' · ')
  }
}
