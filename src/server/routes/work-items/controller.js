import { getWorkItems } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { getAssignableUsers } from '#/server/work-items/core/assignees.js'
import { stateTagClass as resolveStateTagClass } from '#/server/work-items/core/state-badge.js'
import {
  MATERIAL_FILTER_OPTIONS,
  MATERIAL_TOKENS,
  materialLabel
} from '#/server/work-items/core/materials.js'
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

// RA-324 phase-2. The "Type" filter is a frontend-only mapping (the backend
// has no reprocessor/exporter field): Reprocessor -> the real
// `re-accreditation` typeId (filters all current data); Exporter -> a
// not-yet-existing typeId, so selecting it correctly returns zero results.
const TYPE_FILTER_OPTIONS = [
  { value: 're-accreditation', text: 'Reprocessor reaccreditation' },
  { value: 'exporter', text: 'Exporter reaccreditation' }
]
const ALLOWED_TYPE_IDS = new Set(TYPE_FILTER_OPTIONS.map((o) => o.value))

// RA-324 phase-2. The "Status" filter groups the backend state ids under the
// AC06 labels. The single "Updated" option deliberately expands to BOTH
// `assessment-in-progress` and `updated` (they share the "Updated" label), so
// the UI shows one checkbox while the backend receives both state ids. The
// `value` is the stable UI/URL token (submitted via `status=`), decoupled from
// the raw `stateId` backend param.
const STATUS_FILTER_OPTIONS = [
  { value: 'submitted', text: 'Not started', stateIds: ['submitted'] },
  { value: 'duly-made', text: 'Duly made', stateIds: ['duly-made'] },
  {
    value: 'updated',
    text: 'Updated',
    stateIds: ['assessment-in-progress', 'updated']
  },
  {
    value: 'awaiting-decision',
    text: 'Awaiting decision',
    stateIds: ['awaiting-decision']
  },
  { value: 'queried', text: 'Queried', stateIds: ['queried'] },
  { value: 'approved', text: 'Granted', stateIds: ['approved'] },
  { value: 'rejected', text: 'Refused', stateIds: ['rejected'] },
  { value: 'withdrawn', text: 'Withdrawn', stateIds: ['withdrawn'] }
]
const STATUS_OPTION_BY_VALUE = new Map(
  STATUS_FILTER_OPTIONS.map((o) => [o.value, o])
)

// RA-324 phase-2. Server-side sort of the FULL filtered result set. Tokens are
// the wire contract agreed with the backend (epr-z069.6); absent = the
// backend default (newest submitted first).
const SORT_OPTIONS = [
  { value: 'due-date', text: 'Due date' },
  { value: 'organisation', text: 'Organisation' },
  { value: 'status', text: 'Status' }
]
const SORT_VALUES = new Set(SORT_OPTIONS.map((o) => o.value))

// RA-324 phase-2. Nation filter uses plain nation names in the prototype
// order (the role-based single-nation default still applies via
// resolveNations).
const NATION_FILTER_OPTIONS = [
  { value: 'England', text: 'England' },
  { value: 'NorthernIreland', text: 'Northern Ireland' },
  { value: 'Scotland', text: 'Scotland' },
  { value: 'Wales', text: 'Wales' }
]
const NATION_LABEL = new Map(
  NATION_FILTER_OPTIONS.map((o) => [o.value, o.text])
)

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
      materials: filters.materials,
      sort: filters.sort,
      organisation: filters.organisation,
      search: filters.search,
      assigneeId: filters.backendAssigneeId,
      unassigned: filters.backendUnassignedOnly,
      nations: filters.nations,
      includeArchived: filters.includeArchived,
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
      // RA-324. Page is now the "Applications" tiles view. The nav LINK stays
      // labelled "Work items" (AC01) and the route stays /work-items (AC02);
      // only the page heading / title change. No widened container — tiles fit
      // the default constrained width, removing the horizontal-scroll table.
      pageTitle: 'Applications',
      heading: 'Applications',
      breadcrumbs: [{ text: 'Applications' }],
      ok: result.ok,
      error: result.error,
      items,
      filters,
      // RA-324 phase-2 filter sidebar model.
      typeOptions: buildTypeOptions(filters.typeIds),
      statusOptions: buildStatusOptions(filters.statusGroups),
      materialOptions: buildMaterialOptions(filters.materials),
      sortOptions: buildSortOptions(filters.sort),
      nationOptions: buildNationOptions(filters.nations),
      assigneeFilterOptions: buildAssigneeFilterOptions(filters),
      assigneeUserOptions: buildAssigneeUserOptions(filters.assigneeUserId),
      // Active-filters block (removable tags) + counts for the collapsible
      // section summaries.
      activeFilters: buildActiveFilters(filters),
      filterCounts: buildFilterCounts(filters),
      totalCount,
      page,
      pageSize,
      totalPages,
      pagination: buildPagination({ page, totalPages, filters }),
      filterSummary: buildFilterSummary({ filters, totalCount }),
      // RA-127. Surface the create button only when the demo flag is on.
      showCreateWorkItem: config.get('featureFlags.workItemCreationEnabled'),
      hasFilters: hasActiveFilters(filters),
      filtersApplied: filters.filtersApplied
    })
  }
}

function readFilters(query, user) {
  // Type: only the two Type-filter values are accepted (Reprocessor ->
  // re-accreditation, Exporter -> exporter). Unlike phase-1 we do NOT drop the
  // unregistered `exporter` id — it is passed to the backend so selecting
  // Exporter returns zero results (there is no exporter data yet).
  const typeIds = uniqueStringList(query.typeId).filter((id) =>
    ALLOWED_TYPE_IDS.has(id)
  )

  // Status is a UI grouping over backend state ids. Validate the submitted
  // `status` group tokens, then expand to the flattened set of backend state
  // ids (the single "Updated" group expands to two ids).
  const statusGroups = uniqueStringList(query.status).filter((v) =>
    STATUS_OPTION_BY_VALUE.has(v)
  )
  const stateIds = [
    ...new Set(
      statusGroups.flatMap((v) => STATUS_OPTION_BY_VALUE.get(v).stateIds)
    )
  ]

  // Material: repeated `material=` tokens, lower-cased and validated against
  // the canonical token set.
  const materials = uniqueStringList(query.material)
    .map((m) => m.toLowerCase())
    .filter((m) => MATERIAL_TOKENS.includes(m))

  // Sort: one of the agreed tokens, else null (backend default order).
  const sort = SORT_VALUES.has(query.sort) ? query.sort : null

  // Combined "Organisation name or ID" search (backend matches org name OR
  // operatorOrganisationId). Replaces the phase-1 orgId/orgName/registrationId
  // inputs.
  const organisation =
    typeof query.organisation === 'string' ? query.organisation.trim() : ''

  // Preserved free-text search param (no dedicated input in the new UI, but
  // honoured for bookmarked links / existing behaviour).
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

  const includeArchived =
    query.includeArchived === 'true' || query.includeArchived === '1'

  return {
    typeIds,
    statusGroups,
    stateIds,
    materials,
    sort,
    organisation,
    search,
    page,
    assigneeMode,
    assigneeUserId,
    backendAssigneeId,
    backendUnassignedOnly,
    nations: resolveNations(query.nation, user, filtersApplied),
    includeArchived,
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

function decorate(item) {
  const type = getWorkItemType(item.typeId)
  const stateId = item.stateId
  const stateDisplayName =
    type?.states?.find((state) => state.id === stateId)?.displayName ?? stateId

  const archivedAtRaw = item.payload?.archivedAt
  const archivedAt = formatArchivedAt(archivedAtRaw)

  // RA-324 phase-2. The SLA clock starts when assessment starts, so `slaState`
  // is the single signal that gates the card footer ("Assigned to / Due on"):
  // it renders only once the clock has started.
  const slaStarted = Boolean(item.slaState)

  return {
    ...item,
    typeDisplayName: type?.displayName ?? item.typeId,
    stateDisplayName,
    stateTagClass: resolveStateTagClass(stateId),
    assigneeDisplayName: item.assignedToName ?? item.assignedToId ?? null,
    archivedAt,
    // RA-249. The "Application ref" must show the human RA-* reference or
    // nothing — never the work-item Guid. The card link still navigates via
    // `item.id`, so dropping the id fallback here loses no navigation.
    applicationRef: item.payload?.applicationReference ?? null,
    orgName: item.payload?.organisationName ?? null,
    orgId: item.payload?.operatorOrganisationId ?? null,
    material: item.payload?.material ?? null,
    // RA-324 phase-2. The card footer renders only once the SLA clock has
    // started.
    showDueDate: slaStarted,
    // RA-324 phase-2. Absolute SLA due date for the card footer "Due on"
    // (formatted to a GDS date in the template via `formatDateGds`). The
    // backend supplies `slaDueDate` once the clock has started; null before
    // then / when unavailable, so the template renders an em dash.
    dueOn: resolveDueOn(item)
  }
}

/**
 * Format the archivedAt value from the payload. The backend serialises
 * BsonDateTime values in relaxed extended JSON as `{ "$date": "ISO-8601" }`,
 * so we handle both that shape and a plain ISO-8601 string.
 */
function formatArchivedAt(value) {
  if (!value) return null
  const iso =
    typeof value === 'object' &&
    value !== null &&
    typeof value.$date === 'string'
      ? value.$date
      : typeof value === 'string'
        ? value
        : null
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London'
  })
}

/**
 * RA-324 phase-2. Extract the raw ISO-8601 string for the SLA due date from
 * the backend list projection (`slaDueDate`), tolerating the Mongo relaxed
 * extended-JSON `{ $date }` shape as well as a plain string. Returns null when
 * absent (no SLA clock started) so the template renders an em dash. The
 * template formats it to a GDS date via the `formatDateGds` filter.
 */
function resolveDueOn(item) {
  const raw = item.slaDueDate
  if (!raw) return null
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && typeof raw.$date === 'string') {
    return raw.$date
  }
  return null
}

function buildTypeOptions(selectedTypeIds) {
  const selected = new Set(selectedTypeIds)
  return TYPE_FILTER_OPTIONS.map((o) => ({
    value: o.value,
    text: o.text,
    checked: selected.has(o.value)
  }))
}

function buildStatusOptions(selectedStatusGroups) {
  const selected = new Set(selectedStatusGroups)
  return STATUS_FILTER_OPTIONS.map((o) => ({
    value: o.value,
    text: o.text,
    checked: selected.has(o.value)
  }))
}

function buildMaterialOptions(selectedMaterials) {
  const selected = new Set(selectedMaterials)
  return MATERIAL_FILTER_OPTIONS.map((o) => ({
    value: o.value,
    text: o.text,
    checked: selected.has(o.value)
  }))
}

function buildSortOptions(selectedSort) {
  return SORT_OPTIONS.map((o) => ({
    value: o.value,
    text: o.text,
    checked: selectedSort === o.value
  }))
}

function buildNationOptions(selectedNations) {
  const selected = new Set(selectedNations)
  return NATION_FILTER_OPTIONS.map((o) => ({
    value: o.value,
    text: o.text,
    checked: selected.has(o.value)
  }))
}

function buildAssigneeFilterOptions(filters) {
  // RA-324 phase-2 Assignment radios (prototype labels). No explicit "Anyone"
  // option — the unfiltered state is simply nothing selected; the user reverts
  // to it via the active-filter tag or "Clear all filters".
  return [
    {
      value: ASSIGNEE_FILTER_MINE,
      text: 'Your applications',
      checked: filters.assigneeMode === ASSIGNEE_FILTER_MINE
    },
    {
      value: ASSIGNEE_FILTER_UNASSIGNED,
      text: 'Unassigned',
      checked: filters.assigneeMode === ASSIGNEE_FILTER_UNASSIGNED
    },
    {
      value: ASSIGNEE_FILTER_USER,
      text: 'Specific officer',
      checked: filters.assigneeMode === ASSIGNEE_FILTER_USER,
      conditional: { html: '__assignee-user-select__' }
    }
  ]
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
  // `filters` always comes from readFilters (directly, or via a spread in
  // withoutFilter / buildPagination), so every list field is guaranteed to be
  // an array — no nullish guards needed on the loops.
  const params = new URLSearchParams()
  for (const id of filters.typeIds) params.append('typeId', id)
  for (const v of filters.statusGroups) params.append('status', v)
  for (const n of filters.nations) params.append('nation', n)
  for (const m of filters.materials) params.append('material', m)
  if (filters.sort) params.append('sort', filters.sort)
  // Carry the form-submission marker through pagination/back-links so
  // role-based defaults don't silently re-apply mid-paging (RA-125).
  if (filters.filtersApplied) params.append('filtersApplied', '1')
  if (filters.includeArchived) params.append('includeArchived', 'true')
  if (filters.search) params.append('search', filters.search)
  if (filters.organisation) params.append('organisation', filters.organisation)
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

/**
 * Per-section counts for the collapsible filter section summaries
 * ("N selected"). Assignment / sort / organisation are single-select, so each
 * contributes 0 or 1.
 */
function buildFilterCounts(filters) {
  return {
    type: filters.typeIds.length,
    status: filters.statusGroups.length,
    nation: filters.nations.length,
    material: filters.materials.length,
    assignment: filters.assigneeMode !== ASSIGNEE_FILTER_ANY ? 1 : 0,
    sort: filters.sort ? 1 : 0,
    organisation: filters.organisation ? 1 : 0
  }
}

/** True when any filter (or the archived / free-text search) is active. */
function hasActiveFilters(filters) {
  const c = buildFilterCounts(filters)
  return (
    c.type > 0 ||
    c.status > 0 ||
    c.nation > 0 ||
    c.material > 0 ||
    c.assignment > 0 ||
    c.sort > 0 ||
    c.organisation > 0 ||
    filters.includeArchived ||
    filters.search !== ''
  )
}

function assigneeUserName(userId) {
  return getAssignableUsers().find((u) => u.id === userId)?.name ?? userId
}

/**
 * Clone the active filters with a single value removed, so a removal link can
 * rebuild the query without that one filter. Always resets to page 1 (the
 * result set changes) and stamps `filtersApplied` so the nation role-default
 * cannot silently re-apply (RA-125).
 */
function withoutFilter(filters, key, value) {
  const next = { ...filters, page: 1, filtersApplied: true }
  switch (key) {
    case 'type':
      next.typeIds = filters.typeIds.filter((v) => v !== value)
      break
    case 'status':
      next.statusGroups = filters.statusGroups.filter((v) => v !== value)
      break
    case 'nation':
      next.nations = filters.nations.filter((v) => v !== value)
      break
    case 'material':
      next.materials = filters.materials.filter((v) => v !== value)
      break
    case 'assignment':
      next.assigneeMode = ASSIGNEE_FILTER_ANY
      next.assigneeUserId = null
      break
    case 'organisation':
      next.organisation = ''
      break
    case 'sort':
      next.sort = null
      break
  }
  return next
}

/**
 * Build the "Active filters" block: one removable tag per active filter value,
 * each with an href that rebuilds the query minus that one filter. Sort is
 * included so the user can revert to the default order without JavaScript
 * (there is no explicit "default" sort radio).
 */
function buildActiveFilters(filters) {
  // Every value below has already been validated by readFilters against its
  // option list, so the label lookups always resolve — no `?? value` fallback.
  const chips = []
  const add = (key, value, label) =>
    chips.push({
      key,
      label,
      href: buildHref(withoutFilter(filters, key, value))
    })

  const typeLabel = new Map(TYPE_FILTER_OPTIONS.map((o) => [o.value, o.text]))
  for (const id of filters.typeIds) {
    add('type', id, `Type: ${typeLabel.get(id)}`)
  }
  for (const v of filters.statusGroups) {
    add('status', v, `Status: ${STATUS_OPTION_BY_VALUE.get(v).text}`)
  }
  for (const n of filters.nations) {
    add('nation', n, `Nation: ${NATION_LABEL.get(n)}`)
  }
  for (const m of filters.materials) {
    add('material', m, `Material: ${materialLabel(m)}`)
  }
  if (filters.assigneeMode === ASSIGNEE_FILTER_MINE) {
    add('assignment', null, `Assignment: Your applications`)
  } else if (filters.assigneeMode === ASSIGNEE_FILTER_UNASSIGNED) {
    add('assignment', null, `Assignment: Unassigned`)
  } else if (
    filters.assigneeMode === ASSIGNEE_FILTER_USER &&
    filters.assigneeUserId
  ) {
    add(
      'assignment',
      null,
      `Assignment: ${assigneeUserName(filters.assigneeUserId)}`
    )
  }
  if (filters.organisation) {
    add(
      'organisation',
      filters.organisation,
      `Organisation: ${filters.organisation}`
    )
  }
  if (filters.sort) {
    const label = SORT_OPTIONS.find((o) => o.value === filters.sort).text
    add('sort', filters.sort, `Sorted by: ${label}`)
  }

  return { chips, clearAllHref: '/work-items' }
}

function buildFilterSummary({ filters, totalCount }) {
  const parts = []
  if (filters.typeIds.length > 0) {
    const typeLabel = new Map(TYPE_FILTER_OPTIONS.map((o) => [o.value, o.text]))
    parts.push(
      `type: ${filters.typeIds.map((id) => typeLabel.get(id)).join(', ')}`
    )
  }
  if (filters.statusGroups.length > 0) {
    const labels = filters.statusGroups.map(
      (v) => STATUS_OPTION_BY_VALUE.get(v).text
    )
    parts.push(`status: ${labels.join(', ')}`)
  }
  if (filters.nations.length > 0) {
    const labels = filters.nations.map((n) => NATION_LABEL.get(n))
    parts.push(`nation: ${labels.join(', ')}`)
  }
  if (filters.materials.length > 0) {
    parts.push(`material: ${filters.materials.map(materialLabel).join(', ')}`)
  }
  if (filters.organisation) {
    parts.push(`organisation: "${filters.organisation}"`)
  }
  if (filters.assigneeMode === ASSIGNEE_FILTER_MINE) {
    parts.push('your applications')
  } else if (filters.assigneeMode === ASSIGNEE_FILTER_UNASSIGNED) {
    parts.push('unassigned')
  } else if (
    filters.assigneeMode === ASSIGNEE_FILTER_USER &&
    filters.assigneeUserId
  ) {
    parts.push(`assignee: ${assigneeUserName(filters.assigneeUserId)}`)
  }
  if (filters.sort) {
    const label = SORT_OPTIONS.find((o) => o.value === filters.sort).text
    parts.push(`sorted by ${label}`)
  }
  return {
    totalCount,
    description: parts.length === 0 ? null : parts.join(' · ')
  }
}
