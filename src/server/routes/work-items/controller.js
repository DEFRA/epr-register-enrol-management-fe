import { getWorkItems } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { getAssignableUsers } from '#/server/work-items/core/assignees.js'
import { stateTagClass as resolveStateTagClass } from '#/server/work-items/core/state-badge.js'
import {
  MATERIAL_FILTER_OPTIONS,
  MATERIAL_TOKENS,
  materialLabel,
  materialFilterLabel,
  toBackendMaterialTokens
} from '#/server/work-items/core/materials.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { NATION_ROLE_MAP } from '#/server/common/helpers/auth/auth-scopes.js'
import { config } from '#/config/config.js'

const DEFAULT_PAGE_SIZE = 20

// RA-299 (AC10/AC14). yar session key the last-applied filter query is
// persisted under, scoped to this route so it can't collide with other
// session data (e.g. 'user', OAuth state). Reset on every (re-)login (see
// auth/controller.js's OAuth callback and the stub login controller — both
// call request.yar.reset() / start a fresh session), so a new session never
// inherits a previous user's filters. Only ever READ on a bare `/work-items`
// landing (no RECOGNISED_FILTER_PARAMS present) — an explicit filter-cleared
// submission always carries at least `filtersApplied=1`, so it is never
// mistaken for a bare landing and never triggers a restore.
const SESSION_FILTERS_KEY = 'workItemsListFilters'

// Every query param this route reads (see readFilters) plus the form's own
// filtersApplied marker and the pagination page. Used to tell a real filter
// state apart from a bare landing that merely carries an unrelated param.
const RECOGNISED_FILTER_PARAMS = new Set([
  'typeId',
  'applicationType',
  'status',
  'material',
  'nation',
  'sort',
  'organisation',
  'search',
  'assigneeMode',
  'assigneeUserId',
  'includeArchived',
  'filtersApplied',
  'page'
])

// RA-299 AC06. The sort token applied by default on a fresh, unfiltered
// landing (see `resolveSort` below).
const DEFAULT_SORT = 'due-date'

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

// RA-324 phase-2 (RA-299: relabelled "Applicant type" in the UI to
// disambiguate from the new "Application type" filter below — the underlying
// param name/values are unchanged). Frontend-only mapping (the backend has no
// reprocessor/exporter field): Reprocessor -> the real `re-accreditation`
// typeId (filters all current data); Exporter -> a not-yet-existing typeId,
// so selecting it correctly returns zero results.
const TYPE_FILTER_OPTIONS = [
  { value: 're-accreditation', text: 'Reprocessor reaccreditation' },
  { value: 'exporter', text: 'Exporter reaccreditation' }
]
const ALLOWED_TYPE_IDS = new Set(TYPE_FILTER_OPTIONS.map((o) => o.value))
const TYPE_LABEL = new Map(TYPE_FILTER_OPTIONS.map((o) => [o.value, o.text]))

// RA-299 AC01/15. A SECOND, distinct type-style filter: "Application type"
// (what kind of application it is), separate from "Applicant type" (who is
// applying) above. Both dimensions ultimately constrain the same backend
// `typeIds` field (the handler merges the two selections before calling
// getWorkItems), submitted via a separate `applicationType=` query param so
// the two checkbox groups don't collide in the form / active-filter chips.
// Mirrors the SAME not-yet-existing-typeId stub pattern as Exporter above:
// only "Re-accreditation" maps to the real `re-accreditation` typeId (today's
// only work item type); "Accreditation", "Registration application" and
// "Payment of annual registration fee" are BA-requested options with no
// backend type yet, so they are given not-yet-existing typeId tokens and
// correctly return zero results via the backend's `builder.In(w => w.TypeId,
// typeIds)` until those work item types exist.
const APPLICATION_TYPE_FILTER_OPTIONS = [
  { value: 're-accreditation', text: 'Re-accreditation' },
  { value: 'accreditation', text: 'Accreditation' },
  { value: 'registration-application', text: 'Registration application' },
  {
    value: 'annual-fee-payment',
    text: 'Payment of annual registration fee'
  }
]
const ALLOWED_APPLICATION_TYPE_IDS = new Set(
  APPLICATION_TYPE_FILTER_OPTIONS.map((o) => o.value)
)
const APPLICATION_TYPE_LABEL = new Map(
  APPLICATION_TYPE_FILTER_OPTIONS.map((o) => [o.value, o.text])
)

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
const SORT_LABEL = new Map(SORT_OPTIONS.map((o) => [o.value, o.text]))

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

    // RA-299 AC10/14. A genuinely bare landing (NO query string at all — not
    // even `?filtersApplied=1`) restores the last-applied filters from the
    // yar session, if any were saved this session. Any request WITH a query
    // string (a real filter-form submission, a chip-removal link, a
    // pagination link, a bookmarked filtered URL, ...) is itself the
    // "last-applied" state and overwrites the saved value. This keeps the
    // AC06/AC08 hard defaults (due-date sort, "mine" assignee) reserved for
    // the true first-ever bare landing of a session — restored filters are
    // used as-is, defaults are never re-applied on top of them.
    // RA-299 AC12. "Clear all filters" must forget the saved state as well as
    // the current query. It cannot simply link to a bare `/work-items`: that
    // is the restore path above, so the filters the user just cleared would
    // come straight back. `?clear=1` drops the saved filters and lands on the
    // AC06/AC08 default view with no active-filter chips.
    const isClearAll = request.query.clear === '1'
    // Only a query string carrying at least one param we actually understand
    // counts as "the user applied filters". An incidental param on an external
    // link (a tracking tag on a shared/bookmarked URL, say) must not be read as
    // an empty filter submission that silently overwrites the saved filters.
    const hasFilterParams = Object.keys(request.query).some((k) =>
      RECOGNISED_FILTER_PARAMS.has(k)
    )
    let effectiveQuery = request.query
    if (isClearAll) {
      request.yar.clear(SESSION_FILTERS_KEY)
      effectiveQuery = {}
    } else if (hasFilterParams) {
      request.yar.set(SESSION_FILTERS_KEY, request.query)
    } else {
      const savedQuery = request.yar.get(SESSION_FILTERS_KEY)
      if (savedQuery) {
        effectiveQuery = savedQuery
      }
    }

    const filters = readFilters(effectiveQuery, user)

    const result = await getWorkItems({
      // RA-299 AC01/15. "Applicant type" and "Application type" are two
      // separate filter sections in the UI but both constrain the same
      // backend field — merge (and de-dup) the two selections here.
      typeIds: [
        ...new Set([...filters.typeIds, ...filters.applicationTypeIds])
      ],
      stateIds: filters.stateIds,
      // RA-299 AC05. `filters.materials` holds the UI-facing filter values
      // (e.g. the split 'glass-remelt' / 'glass-other'); translate to the
      // real backend material token(s) before querying.
      materials: toBackendMaterialTokens(filters.materials),
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
    // RA-324 phase-2. The results count is just the item range + total
    // ("Showing 1-10 of 277") — no filter/sort recap, which the Active
    // filters chips already communicate. `rangeEnd` uses the actual rendered
    // item count (not `page * pageSize`) so a partial last page reports
    // correctly (e.g. "271-277 of 277").
    const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
    const rangeEnd = totalCount === 0 ? 0 : rangeStart + items.length - 1

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
      applicationTypeOptions: buildApplicationTypeOptions(
        filters.applicationTypeIds
      ),
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
      rangeStart,
      rangeEnd,
      pagination: buildPagination({ page, totalPages, filters }),
      // RA-127. Surface the create button only when the demo flag is on.
      showCreateWorkItem: config.get('featureFlags.workItemCreationEnabled'),
      hasFilters: hasActiveFilters(filters),
      filtersApplied: filters.filtersApplied
    })
  }
}

function readFilters(query, user) {
  // Hidden form marker that lets the controller distinguish 'user
  // submitted the filter form' from 'fresh GET of /work-items'. Without
  // this, role-based defaults (e.g. nation) would silently re-apply when
  // the user explicitly cleared them (RA-125). Computed up-front: the
  // RA-299 sort/assignee defaults below need it too.
  const filtersApplied = query.filtersApplied === '1'

  // Type ("Applicant type" in the UI): only the two Type-filter values are
  // accepted (Reprocessor -> re-accreditation, Exporter -> exporter). Unlike
  // phase-1 we do NOT drop the unregistered `exporter` id — it is passed to
  // the backend so selecting Exporter returns zero results (there is no
  // exporter data yet).
  const typeIds = uniqueStringList(query.typeId).filter((id) =>
    ALLOWED_TYPE_IDS.has(id)
  )

  // RA-299 AC01/15. "Application type": a second, independent typeId-style
  // filter (see APPLICATION_TYPE_FILTER_OPTIONS above for the stub-typeId
  // reasoning). Read exactly like `typeIds` above, just from a different
  // query param and option list; merged with `typeIds` by the handler before
  // querying the backend.
  const applicationTypeIds = uniqueStringList(query.applicationType).filter(
    (id) => ALLOWED_APPLICATION_TYPE_IDS.has(id)
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
  // the canonical token set. Dedup AFTER lower-casing so `?material=Plastic&
  // material=plastic` collapses to a single token (uniqueStringList dedups
  // case-sensitively, which would otherwise leak a duplicate chip).
  const materials = [
    ...new Set(uniqueStringList(query.material).map((m) => m.toLowerCase()))
  ].filter((m) => MATERIAL_TOKENS.includes(m))

  // Sort: one of the agreed tokens, else the RA-299 AC06 filtersApplied-aware
  // default (mirrors resolveNations' shape exactly). `sortExplicit` tracks
  // whether the user actually chose the sort (vs it being silently defaulted)
  // so buildActiveFilters can suppress a spurious "Sorted by: Due date" chip
  // for the default.
  const { value: sort, explicit: sortExplicit } = resolveSort(
    query.sort,
    filtersApplied
  )

  // Combined "Organisation name or ID" search (backend matches org name OR
  // operatorOrganisationId). Replaces the phase-1 orgId/orgName/registrationId
  // inputs.
  const organisation =
    typeof query.organisation === 'string' ? query.organisation.trim() : ''

  // Preserved free-text search param (no dedicated input in the new UI, but
  // honoured for bookmarked links / existing behaviour).
  const search = typeof query.search === 'string' ? query.search.trim() : ''

  const page = clampPositiveInt(query.page, 1)

  // RA-299 AC08/09. Mirrors resolveNations' filtersApplied-aware shape
  // exactly: an explicit `assigneeMode` value wins; a form submission
  // (filtersApplied) with no assignee option ticked honours that as "show
  // all"; otherwise (a fresh, non-explicit landing) default to "mine".
  // `assigneeModeExplicit` mirrors `sortExplicit`: false for the silent
  // default, so it doesn't render as a removable active-filter chip.
  const { value: assigneeMode, explicit: assigneeModeExplicit } =
    resolveAssigneeMode(query.assigneeMode, filtersApplied)
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

  const includeArchived =
    query.includeArchived === 'true' || query.includeArchived === '1'

  return {
    typeIds,
    applicationTypeIds,
    statusGroups,
    stateIds,
    materials,
    sort,
    sortExplicit,
    organisation,
    search,
    page,
    assigneeMode,
    assigneeModeExplicit,
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

/**
 * Resolve the active sort order (RA-299 AC06).
 *
 * An explicit, recognised `sort` query value always wins. A present-but-
 * unrecognised value (e.g. a stale/bookmarked `sort=sideways`) is treated as
 * an explicit "no sort" — same as the pre-RA-299 behaviour for junk input —
 * rather than reviving the default. Only a genuinely ABSENT `sort` param,
 * on a request that is not an explicit filter-form submission
 * (`filtersApplied`), defaults to `DEFAULT_SORT` ('due-date'). The returned
 * `explicit` flag is false for the defaulted case so the caller (
 * `buildActiveFilters`) can avoid rendering a spurious "Sorted by: Due date"
 * chip for a value the user never actually chose.
 */
function resolveSort(rawValue, filtersApplied) {
  if (SORT_VALUES.has(rawValue)) {
    return { value: rawValue, explicit: true }
  }
  if (rawValue !== undefined) {
    return { value: null, explicit: false }
  }
  if (filtersApplied) {
    return { value: null, explicit: false }
  }
  return { value: DEFAULT_SORT, explicit: false }
}

/**
 * Resolve the active assignee filter mode (RA-299 AC08/09).
 *
 * Mirrors `resolveSort` above: an explicit, recognised `assigneeMode` value
 * wins; a present-but-unrecognised value is an explicit "no filter" (matches
 * the pre-RA-299 behaviour); a genuinely ABSENT `assigneeMode`, on a request
 * that is not an explicit filter-form submission, defaults to "mine" so a
 * caseworker's own queue is pre-selected without having to apply the filter
 * every time. A submitted form with no assignee option ticked
 * (`filtersApplied` true, `assigneeMode` absent) honours that as "show all",
 * exactly like `resolveNations` does for an emptied nation selection
 * (RA-125).
 */
function resolveAssigneeMode(rawValue, filtersApplied) {
  if (
    rawValue === ASSIGNEE_FILTER_MINE ||
    rawValue === ASSIGNEE_FILTER_UNASSIGNED ||
    rawValue === ASSIGNEE_FILTER_USER
  ) {
    return { value: rawValue, explicit: true }
  }
  if (rawValue !== undefined) {
    return { value: ASSIGNEE_FILTER_ANY, explicit: false }
  }
  if (filtersApplied) {
    return { value: ASSIGNEE_FILTER_ANY, explicit: false }
  }
  return { value: ASSIGNEE_FILTER_MINE, explicit: false }
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
    // RA-324. Present the material DISPLAY LABEL on the card (e.g. "Plastic",
    // "Fibre-based composite material"), matching the filter checkboxes,
    // active-filter chips and summary — never the raw lowercase token.
    material: materialLabel(item.payload?.material),
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
 * Extract a plain ISO-8601 string from a value that is either a string or the
 * Mongo relaxed extended-JSON `{ "$date": "ISO-8601" }` shape the backend
 * serialises BsonDateTime values as. Returns null for anything else (absent,
 * or an unexpected object).
 */
function unwrapMongoDate(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && typeof value.$date === 'string') {
    return value.$date
  }
  return null
}

/**
 * Format the archivedAt value from the payload into a GDS date, or null when
 * it is absent / unparseable.
 */
function formatArchivedAt(value) {
  const iso = unwrapMongoDate(value)
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
 * RA-324 phase-2. The raw ISO-8601 SLA due date from the backend list
 * projection (`slaDueDate`), or null when absent (no SLA clock started) so the
 * template renders an em dash. The template formats it via `formatDateGds`.
 */
function resolveDueOn(item) {
  return unwrapMongoDate(item.slaDueDate)
}

function buildTypeOptions(selectedTypeIds) {
  const selected = new Set(selectedTypeIds)
  return TYPE_FILTER_OPTIONS.map((o) => ({
    value: o.value,
    text: o.text,
    checked: selected.has(o.value)
  }))
}

function buildApplicationTypeOptions(selectedApplicationTypeIds) {
  const selected = new Set(selectedApplicationTypeIds)
  return APPLICATION_TYPE_FILTER_OPTIONS.map((o) => ({
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
  for (const id of filters.applicationTypeIds) {
    params.append('applicationType', id)
  }
  for (const v of filters.statusGroups) params.append('status', v)
  for (const n of filters.nations) params.append('nation', n)
  for (const m of filters.materials) params.append('material', m)
  // RA-299 AC06. Only carry `sort=` forward when it was an explicit user
  // choice — a silently-defaulted sort must not "leak" into the URL as if it
  // were user-chosen (readFilters re-derives the same default on every
  // request where filtersApplied is still false, so nothing is lost by
  // omitting it here).
  if (filters.sort && filters.sortExplicit) {
    params.append('sort', filters.sort)
  }
  // Carry the form-submission marker through pagination/back-links so
  // role-based defaults don't silently re-apply mid-paging (RA-125).
  if (filters.filtersApplied) params.append('filtersApplied', '1')
  if (filters.includeArchived) params.append('includeArchived', 'true')
  if (filters.search) params.append('search', filters.search)
  if (filters.organisation) params.append('organisation', filters.organisation)
  // RA-299 AC08/09. Same reasoning as `sort` above: only carry
  // `assigneeMode=` forward when it was an explicit user choice, so the
  // silent "mine" default doesn't leak into pagination/chip-removal hrefs as
  // if the user had picked it (readFilters re-derives the same default on
  // every request where filtersApplied is still false).
  if (
    filters.assigneeModeExplicit &&
    filters.assigneeMode !== ASSIGNEE_FILTER_ANY
  ) {
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
    applicationType: filters.applicationTypeIds.length,
    status: filters.statusGroups.length,
    nation: filters.nations.length,
    material: filters.materials.length,
    // RA-299 AC08/09/AC06: gated on the *explicit* flag, not the resolved
    // value, so the AC06/AC08 silent defaults (due-date sort, "mine"
    // assignee) don't count as an "active filter" — they must not flip the
    // empty-state message to "No work items match your filters." or open/
    // count the collapsible section on a plain default landing.
    assignment: filters.assigneeModeExplicit ? 1 : 0,
    sort: filters.sortExplicit ? 1 : 0,
    organisation: filters.organisation ? 1 : 0,
    archived: filters.includeArchived ? 1 : 0
  }
}

/** True when any filter (or the archived / free-text search) is active. */
function hasActiveFilters(filters) {
  const c = buildFilterCounts(filters)
  return (
    c.type > 0 ||
    c.applicationType > 0 ||
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
    case 'applicationType':
      next.applicationTypeIds = filters.applicationTypeIds.filter(
        (v) => v !== value
      )
      break
    case 'material':
      next.materials = filters.materials.filter((v) => v !== value)
      break
    case 'assignment':
      next.assigneeMode = ASSIGNEE_FILTER_ANY
      next.assigneeModeExplicit = false
      next.assigneeUserId = null
      break
    case 'organisation':
      next.organisation = ''
      break
    case 'sort':
      next.sort = null
      next.sortExplicit = false
      break
    case 'archived':
      next.includeArchived = false
      break
  }
  return next
}

/**
 * Build the "Active filters" block: one removable tag per active filter value,
 * each with an href that rebuilds the query minus that one filter. Chip
 * labels are just the value ("England", "Reprocessor reaccreditation") — no
 * category prefix — except Sort, which keeps "Sorted by: {value}" since a
 * bare sort value reads ambiguously as a chip. Sort is included so the user
 * can revert to the default order without JavaScript (there is no explicit
 * "default" sort radio).
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

  // RA-324 prototype fix: chips show ONLY the value (e.g. "England",
  // "Reprocessor reaccreditation") — no "Nation:" / "Type:" category prefix,
  // since the category is inferable from the value itself. Sort is the sole
  // exception (kept below): a bare sort value ("Due date") reads ambiguously
  // as a chip, so it keeps its "Sorted by: " prefix.
  for (const id of filters.typeIds) {
    add('type', id, TYPE_LABEL.get(id))
  }
  // RA-299 AC01/15. Application-type chips, same shape as Applicant-type.
  for (const id of filters.applicationTypeIds) {
    add('applicationType', id, APPLICATION_TYPE_LABEL.get(id))
  }
  for (const v of filters.statusGroups) {
    add('status', v, STATUS_OPTION_BY_VALUE.get(v).text)
  }
  for (const n of filters.nations) {
    add('nation', n, NATION_LABEL.get(n))
  }
  // RA-299 AC05. `m` is the UI filter value (e.g. 'glass-remelt'), not the
  // raw backend payload token — use materialFilterLabel, not materialLabel.
  for (const m of filters.materials) {
    add('material', m, materialFilterLabel(m))
  }
  // RA-299 AC08/09. Only render the assignment chip for an EXPLICIT
  // selection — the silent "mine" default must not appear as a removable
  // chip (there'd be nothing meaningful to "remove" back to; the user just
  // wouldn't see a chip for the view they're already on).
  if (filters.assigneeModeExplicit) {
    if (filters.assigneeMode === ASSIGNEE_FILTER_MINE) {
      add('assignment', null, 'Your applications')
    } else if (filters.assigneeMode === ASSIGNEE_FILTER_UNASSIGNED) {
      add('assignment', null, 'Unassigned')
    } else if (
      filters.assigneeMode === ASSIGNEE_FILTER_USER &&
      filters.assigneeUserId
    ) {
      add('assignment', null, assigneeUserName(filters.assigneeUserId))
    }
  }
  if (filters.organisation) {
    add('organisation', filters.organisation, filters.organisation)
  }
  // RA-299 AC06. Same reasoning as assignment above: only an EXPLICIT sort
  // choice renders a "Sorted by: " chip — the silent due-date default must
  // not appear as one (the prototype screenshot shows no such chip).
  if (filters.sortExplicit) {
    add('sort', filters.sort, `Sorted by: ${SORT_LABEL.get(filters.sort)}`)
  }
  if (filters.includeArchived) {
    add('archived', 'true', 'Archived')
  }

  // `?clear=1` rather than a bare `/work-items` so the handler also drops the
  // session-persisted filters (RA-299 AC12) instead of restoring them.
  return { chips, clearAllHref: '/work-items?clear=1' }
}
