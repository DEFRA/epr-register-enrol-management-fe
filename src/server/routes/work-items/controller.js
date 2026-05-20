import { getWorkItems } from '#/server/common/helpers/backend-api/backend-api.js'
import {
  getWorkItemType,
  getWorkItemTypes
} from '#/server/work-items/core/registry.js'
import { getAssignableUsers } from '#/server/work-items/core/assignees.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { NATION_ROLE_MAP } from '#/server/common/helpers/auth/auth-scopes.js'
import { config } from '#/config/config.js'

const DEFAULT_PAGE_SIZE = 20

/**
 * Valid nation values accepted by the backend (RA-125). Derived from
 * NATION_ROLE_MAP so the role->nation mapping stays the single source of
 * truth and the two lists cannot drift apart.
 */
const VALID_NATIONS = Object.values(NATION_ROLE_MAP)

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
      nations: filters.nations,
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
      breadcrumbs: [{ text: 'Home', href: '/' }, { text: 'Work items' }],
      ok: result.ok,
      error: result.error,
      items,
      filters,
      typeOptions: buildTypeOptions(filters.typeIds),
      stateOptions: buildStateOptions(filters.stateIds),
      nationOptions: buildNationOptions(filters.nations),
      assigneeFilterOptions: buildAssigneeFilterOptions(filters, user),
      assigneeUserOptions: buildAssigneeUserOptions(filters.assigneeUserId),
      totalCount,
      page,
      pageSize,
      totalPages,
      pagination: buildPagination({ page, totalPages, filters }),
      filterSummary: buildFilterSummary({ filters, totalCount }),
      // RA-127. Surface the create button only when the demo flag is on.
      showCreateWorkItem: config.get('featureFlags.workItemCreationEnabled'),
      hasFilters:
        filters.typeIds.length > 0 ||
        filters.stateIds.length > 0 ||
        filters.search !== '' ||
        filters.assigneeMode !== ASSIGNEE_FILTER_ANY ||
        filters.nations.length > 0,
      filtersApplied: filters.filtersApplied
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

  const search = typeof query.search === 'string' ? query.search.trim() : ''

  const page = clampPositiveInt(query.page, 1)

  const assigneeMode = normaliseAssigneeMode(query.assigneeMode)
  const assigneeUserId =
    typeof query.assigneeUserId === 'string' &&
    query.assigneeUserId.trim() !== ''
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

  // Hidden form marker that lets the controller distinguish 'user
  // submitted the filter form' from 'fresh GET of /work-items'. Without
  // this, role-based defaults (e.g. nation) would silently re-apply when
  // the user explicitly cleared them (RA-125).
  const filtersApplied = query.filtersApplied === '1'

  return {
    typeIds,
    stateIds,
    search,
    page,
    assigneeMode,
    assigneeUserId,
    backendAssigneeId,
    backendUnassignedOnly,
    nations: resolveNations(query.nation, user, filtersApplied),
    filtersApplied
  }
}

/**
 * Resolve the active nation filter.
 *
 * If the query string supplies explicit nation values, use those (validated
 * against the known set). Otherwise, if the authenticated user has exactly
 * one nation role *and* the request is not an explicit form submission,
 * default to that nation so regulators see their own queue first without
 * having to manually apply the filter every time. When the user submits
 * the filter form with no nation boxes ticked we honour that empty
 * selection so they can see all nations or another nation's queue (RA-125).
 */
function resolveNations(nationParam, user, filtersApplied) {
  const explicit = uniqueStringList(nationParam).filter((n) =>
    VALID_NATIONS.includes(n)
  )
  if (explicit.length > 0) {
    return explicit
  }

  // The user submitted the filter form with every nation unchecked --
  // respect that and don't fall through to the role-based default.
  if (filtersApplied) {
    return []
  }

  // No explicit filter — check for a single nation role on the user.
  const userRoles = user?.roles ?? []
  const nationRoles = userRoles.filter((r) => Object.hasOwn(NATION_ROLE_MAP, r))
  if (nationRoles.length === 1) {
    return [NATION_ROLE_MAP[nationRoles[0]]]
  }

  return []
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

// GOV.UK Design system tag colours for the cross-type work item State
// column. Keys match registered state ids; unknown ids fall through to
// the neutral grey tag.
const STATE_TAG_CLASSES = {
  submitted: 'govuk-tag--blue',
  'assessment-in-progress': 'govuk-tag--light-blue',
  'awaiting-decision': 'govuk-tag--yellow',
  approved: 'govuk-tag--green',
  rejected: 'govuk-tag--red',
  withdrawn: 'govuk-tag--grey'
}

const SLA_TAG = {
  OnTrack: { text: 'On track', classes: 'govuk-tag--green' },
  AtRisk: { text: 'At risk', classes: 'govuk-tag--yellow' },
  Breached: { text: 'Breached', classes: 'govuk-tag--red' }
}

/**
 * Parse the integer day count from a .NET "c" format TimeSpan string.
 * Format: [-][d.]hh:mm:ss[.fraction]  e.g. "84.00:00:00", "14.12:30:00".
 * Returns null when the value is absent or not parseable.
 */
function parseDotNetTimeSpanDays(value) {
  if (!value || typeof value !== 'string') return null
  const negative = value.startsWith('-')
  const s = negative ? value.slice(1) : value
  const dotIdx = s.indexOf('.')
  const colonIdx = s.indexOf(':')
  if (dotIdx !== -1 && dotIdx < colonIdx) {
    const days = parseInt(s.slice(0, dotIdx), 10)
    return negative ? -days : days
  }
  return 0
}

function formatSlaRemaining(slaRemaining) {
  const days = parseDotNetTimeSpanDays(slaRemaining)
  if (days === null || days <= 0) return null
  return days === 1 ? '1 day remaining' : `${days} days remaining`
}

function decorate(item) {
  const type = getWorkItemType(item.typeId)
  const stateId = item.stateId
  const stateDisplayName =
    type?.states?.find((state) => state.id === stateId)?.displayName ?? stateId

  const slaTag = item.slaState ? SLA_TAG[item.slaState] : null
  const slaRemainingText =
    item.slaState && item.slaState !== 'Breached'
      ? formatSlaRemaining(item.slaRemaining)
      : null

  return {
    ...item,
    typeDisplayName: type?.displayName ?? item.typeId,
    stateDisplayName,
    stateTagClass: STATE_TAG_CLASSES[stateId] ?? 'govuk-tag--grey',
    assigneeDisplayName: item.assignedToName ?? item.assignedToId ?? null,
    slaTagText: slaTag?.text ?? null,
    slaTagClass: slaTag?.classes ?? null,
    slaRemainingText
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

function buildNationOptions(selectedNations) {
  const selected = new Set(selectedNations)
  return VALID_NATIONS.map((nation) => ({
    value: nation,
    text: nation === 'NorthernIreland' ? 'Northern Ireland' : nation,
    checked: selected.has(nation)
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
      text: user?.name ? `Assigned to me (${user.name})` : 'Assigned to me',
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
  for (const n of filters.nations ?? []) params.append('nation', n)
  // Carry the form-submission marker through pagination/back-links so
  // role-based defaults don't silently re-apply mid-paging (RA-125).
  if (filters.filtersApplied) params.append('filtersApplied', '1')
  if (filters.search) params.append('search', filters.search)
  if (filters.assigneeMode && filters.assigneeMode !== ASSIGNEE_FILTER_ANY) {
    params.append('assigneeMode', filters.assigneeMode)
    if (
      filters.assigneeMode === ASSIGNEE_FILTER_USER &&
      filters.assigneeUserId
    ) {
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
  if (filters.nations.length > 0) {
    const labels = filters.nations.map((n) =>
      n === 'NorthernIreland' ? 'Northern Ireland' : n
    )
    parts.push(`nation: ${labels.join(', ')}`)
  }
  if (filters.search) {
    parts.push(`search: "${filters.search}"`)
  }
  if (filters.assigneeMode === ASSIGNEE_FILTER_MINE) {
    parts.push('assigned to me')
  } else if (filters.assigneeMode === ASSIGNEE_FILTER_UNASSIGNED) {
    parts.push('unassigned')
  } else if (
    filters.assigneeMode === ASSIGNEE_FILTER_USER &&
    filters.assigneeUserId
  ) {
    parts.push(`assignee: ${filters.assigneeUserId}`)
  }
  return {
    totalCount,
    description: parts.length === 0 ? null : parts.join(' · ')
  }
}
