import { getWorkItems } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { getAssignableUsers } from '#/server/work-items/core/assignees.js'
import { stateTagClass as resolveStateTagClass } from '#/server/work-items/core/state-badge.js'
import { materialLabel } from '#/server/work-items/core/materials.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { unwrapMongoDate } from '#/server/common/helpers/format/mongo-date.js'
import { config } from '#/config/config.js'
import { isExporterApplication } from './application-summary.js'
import { resolveOrganisationId, stateDisplayName } from './case-header.js'
import { requestTypeLabel } from '#/server/work-items/core/request-type-label.js'
import { CHECKBOX_FILTERS, resolveTypeFilter } from './list-filters.js'
import {
  appendCheckboxFilterParams,
  buildCheckboxOptions,
  checkboxFilterParamNames,
  checkboxFilterChips,
  checkboxFilterCounts,
  checkboxFilterRequest,
  checkboxFilterSections,
  isCheckboxFilterKey,
  readCheckboxFilters,
  withoutCheckboxValue
} from './checkbox-filters.js'

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

// Every query param this route reads (see readFilters and CHECKBOX_FILTERS)
// plus the form's own filtersApplied marker and the pagination page. Used to
// tell a real filter state apart from a bare landing that merely carries an
// unrelated param.
const RECOGNISED_FILTER_PARAMS = new Set([
  ...checkboxFilterParamNames(CHECKBOX_FILTERS),
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

const ASSIGNEE_FILTER_ANY = 'any'
const ASSIGNEE_FILTER_MINE = 'mine'
const ASSIGNEE_FILTER_UNASSIGNED = 'unassigned'
const ASSIGNEE_FILTER_USER = 'user'

// RA-370. States in which the application assessment has NOT yet started, and
// so the card shows "Submitted on". Assessment work begins at
// 'assessment-in-progress' (that is the first state carrying assessment tasks
// — 'duly-made' carries only "Confirm registration fee paid"), so everything
// up to and including 'duly-made' is pre-assessment.
//
// This is deliberately keyed off `stateId` and NOT off the SLA clock, because
// "clock running" does NOT mean "assessment started". A duly-made item
// normally already has a clock: ReAccreditationDulyMadeHook stamps
// `SlaClock = new WorkItemSlaClock { StartedAt = now }` in the same write that
// moves the item to 'duly-made', and ReAccreditationDulyMadeSlaClockBackfill-
// Migration back-fills one onto any duly-made item still missing it (as does
// ReAccreditationDulyMadeSnapshotMigration for items it promotes). So a
// pre-assessment item WITH a running clock is the steady state of the ordinary
// journey, not an edge case — gating on the clock hid "Submitted on" for
// essentially every duly-made item. Verified end-to-end: an item taken through
// the UI reads sub=true/due=false in 'submitted', sub=true/due=true in
// 'duly-made', and sub=false/due=true after the start step
// ('start-assessment', RA-595) — until the RA-527 follow-up kept a started
// case "Duly made" (see below), after which it reads sub=true/due=true too.
//
// The two dates are therefore gated on independent signals, and there is NO
// invariant about how many of them render. Both cases below are intended:
//   - BOTH render for a clock-carrying 'duly-made' item, i.e. the normal case
//     above. Correct: the submission date is still the relevant one to show,
//     and the clock genuinely is running, so the deadline is real.
//   - NEITHER renders for a post-'duly-made' item with no clock (for
//     example, legacy data). The footer then carries "Assigned to" alone,
//     which is better than inventing a date.
//
// KNOWN PARTIAL MISS (bead epr-r2s4, separate story): 'queried' and 'updated'
// are reachable from BOTH pre-assessment ('query-during-duly-making',
// 'query-during-duly-made') and post-assessment ('query-during-assessment',
// 'query-during-decision') transitions, so `stateId` alone cannot tell whether
// assessment ever started. Such items do not show "Submitted on" even when it
// never did. Resolving that needs the originating state; do not try to patch
// it here.
//
// RA-527 follow-up. 'assessment-started' (a started case that still reads
// "Duly made") is included so its card is identical to a Duly made card:
// "Submitted on" and the due date.
const PRE_ASSESSMENT_STATE_IDS = new Set([
  'submitted',
  'duly-made',
  'assessment-started'
])

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
    const assignableUsers = await getAssignableUsers()

    const result = await getWorkItems({
      ...resolveTypeFilter(filters.selected),
      // Applicant type, Status, Nation and Material (see CHECKBOX_FILTERS).
      ...checkboxFilterRequest(CHECKBOX_FILTERS, filters.selected),
      sort: filters.sort,
      organisation: filters.organisation,
      search: filters.search,
      assigneeId: filters.backendAssigneeId,
      unassigned: filters.backendUnassignedOnly,
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
      // RA-324 phase-2 filter sidebar model. The checkbox filter sections
      // are keyed by CHECKBOX_FILTERS key.
      checkboxSections: checkboxFilterSections(
        CHECKBOX_FILTERS,
        filters.selected
      ),
      sortOptions: buildCheckboxOptions(SORT_OPTIONS, [filters.sort]),
      assigneeFilterOptions: buildAssigneeFilterOptions(filters),
      assigneeUserOptions: buildAssigneeUserOptions(
        filters.assigneeUserId,
        assignableUsers
      ),
      // Active-filters block (removable tags) + counts for the collapsible
      // section summaries.
      activeFilters: buildActiveFilters(filters, assignableUsers),
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

  // The checkbox filters' values, keyed by CHECKBOX_FILTERS key.
  const selected = readCheckboxFilters(CHECKBOX_FILTERS, query, {
    user,
    filtersApplied
  })

  // Sort: one of the agreed tokens, else the RA-299 AC06 filtersApplied-aware
  // default (mirrors the Nation filter's default in CHECKBOX_FILTERS).
  // `sortExplicit` tracks whether the user actually chose the sort (vs it
  // being silently defaulted) so buildActiveFilters can suppress a spurious
  // "Sorted by: Due date" chip for the default.
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

  // RA-299 AC08/09. Mirrors the Nation default's filtersApplied-aware shape
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
    selected,
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
    includeArchived,
    filtersApplied
  }
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
 * exactly like the Nation default (list-filters.js) does for an emptied
 * nation selection (RA-125).
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

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback
}

function typeCardFields(type, payload, stateId) {
  return {
    // RA-739. A type's category is its card's modifier, and a type that
    // describes a site (add-ORS) shows it in place of the registration number.
    cardModifier: type?.category ?? null,
    cardSite: type?.describeCardSite?.(payload) ?? null,
    // RA-739. The card's first line starts with the request type: RA-681,
    // the type's label for this work item's payload.
    requestType: requestTypeLabel(type, payload),
    stateDisplayName: stateDisplayName(type, stateId),
    // The two card dates are gated INDEPENDENTLY — see the block comment above
    // PRE_ASSESSMENT_STATE_IDS for why, and for the cases where both or
    // neither render.
    showSubmittedOn:
      Boolean(type?.cardAlwaysShowsSubmittedOn) ||
      PRE_ASSESSMENT_STATE_IDS.has(stateId)
  }
}

function payloadCardFields(payload) {
  return {
    // RA-739. After the type's display name, the card's first line shows the
    // submission reference and request count, each when present.
    submissionReference: payload.submissionReference ?? null,
    submissionCount: formatSubmissionCount(payload.submissionSize),
    archivedAt: formatArchivedAt(payload.archivedAt),
    // RA-249. The "Application ref" must show the human RA-* reference or
    // nothing — never the work-item Guid. The card link still navigates via
    // `item.id`, so dropping the id fallback here loses no navigation.
    applicationRef: payload.applicationReference ?? null,
    orgName: payload.organisationName ?? null,
    // RA-503: operatorOrganisationId is ReEx's internal ObjectId for a real operator
    // submission — never safe to show. resolveOrganisationId prefers operatorOrgNumber and only
    // falls back to operatorOrganisationId when it is itself genuinely 6-digit numeric (an
    // admin-created work item). See case-header.js.
    orgId: resolveOrganisationId(payload),
    // RA-295 AC06. The operator's registration number on each card. NOTE:
    // this is `registrationNumber` (e.g. "EPR-100999") — deliberately NOT
    // `operatorRegistrationId` (e.g. "reg-008", RA-223's "Registration ID"),
    // which is a different field with a confusingly similar name.
    registrationNumber: payload.registrationNumber ?? null,
    // RA-324. Present the material DISPLAY LABEL on the card (e.g. "Plastic",
    // "Fibre-based composite material"), matching the filter checkboxes,
    // active-filter chips and summary — never the raw lowercase token.
    material: materialLabel(payload.material)
  }
}

function decorate(item) {
  const type = getWorkItemType(item.typeId)
  const stateId = item.stateId
  const payload = item.payload ?? {}

  // RA-412. `payload.wasteProcessingType` is the real reprocessor/exporter
  // discriminator: the operator backend has written it into every submitted
  // work-item payload since RA-314, and management-be forwards it untouched
  // (the payload is a schema-less BsonDocument). A work item submitted
  // before RA-314 carries no such field, so it falls back to "Reprocessor" —
  // the value every card showed before this fix, preserving on-screen
  // behaviour for old data. Shared with the application-summary page's own
  // BES/ORS gating so the two derivations of "is this an Exporter
  // application" can't drift apart.
  const isExporter = isExporterApplication(item)
  const applicantType = isExporter ? 'Exporter' : 'Reprocessor'

  // RA-324 phase-2. `slaState` is non-null exactly when the work item carries
  // an SLA clock, and it gates "Due on" alone.
  //
  // RA-359 part 2. A terminal/withdrawn item now reports the new `Cancelled`
  // SLA state (management-be) while keeping its `slaDueDate`. `Cancelled` is a
  // STOPPED clock, not a running one, so it must not surface a live "Due on" —
  // treat it exactly like "no active SLA". OnTrack/AtRisk/Breached unchanged.
  const slaStarted = Boolean(item.slaState) && item.slaState !== 'Cancelled'

  return {
    ...item,
    ...typeCardFields(type, payload, stateId),
    ...payloadCardFields(payload),
    stateTagClass: resolveStateTagClass(stateId),
    assigneeDisplayName: item.assignedToName ?? item.assignedToId ?? null,
    // RA-412. The card's applicant-type label — see the comment above.
    applicantType,
    // The due date is gated independently of `showSubmittedOn` — see the
    // block comment above PRE_ASSESSMENT_STATE_IDS.
    showDueDate: slaStarted,
    // Both dates arrive either as a plain ISO-8601 string or as the Mongo
    // `{ $date }` wrapper, hence `unwrapMongoDate`; null for an absent or
    // unexpected shape. The template formats each via `formatDateGds`, which
    // also yields '' for a present-but-unparseable value, so the template
    // falls through to an em dash in every bad-input case.
    dueOn: unwrapMongoDate(item.slaDueDate),
    submittedOn: unwrapMongoDate(item.submittedAt)
  }
}

/**
 * RA-739. "(N requests)" for a submission split into more than one work item;
 * null for a single request or an absent/invalid size, so the card shows no
 * count.
 */
function formatSubmissionCount(size) {
  return Number.isInteger(size) && size > 1 ? `(${size} requests)` : null
}

/**
 * Format the archivedAt value from the payload into a GDS date, or null when
 * it is absent / unparseable.
 */
function formatArchivedAt(value) {
  const iso = unwrapMongoDate(value)
  if (!iso) {
    return null
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return null
  }
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London'
  })
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

function buildAssigneeUserOptions(selectedUserId, assignableUsers) {
  const items = [
    { value: '', text: 'Select a user', selected: !selectedUserId }
  ]
  for (const u of assignableUsers) {
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
  if (totalPages <= 1) {
    return null
  }

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
  // withoutFilter / buildPagination), so every checkbox filter has an array of
  // values — no nullish guards needed.
  const params = new URLSearchParams()
  appendCheckboxFilterParams(params, CHECKBOX_FILTERS, filters.selected)
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
  if (filters.filtersApplied) {
    params.append('filtersApplied', '1')
  }
  if (filters.includeArchived) {
    params.append('includeArchived', 'true')
  }
  if (filters.search) {
    params.append('search', filters.search)
  }
  if (filters.organisation) {
    params.append('organisation', filters.organisation)
  }
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
    ...checkboxFilterCounts(CHECKBOX_FILTERS, filters.selected),
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
  // The archived count covers `includeArchived`.
  return (
    Object.values(buildFilterCounts(filters)).some((count) => count > 0) ||
    filters.search !== ''
  )
}

function assigneeUserName(userId, assignableUsers) {
  return assignableUsers.find((u) => u.id === userId)?.name ?? userId
}

/**
 * Clone the active filters with a single value removed, so a removal link can
 * rebuild the query without that one filter. Always resets to page 1 (the
 * result set changes) and stamps `filtersApplied` so the nation role-default
 * cannot silently re-apply (RA-125).
 */
function withoutFilter(filters, key, value) {
  const next = { ...filters, page: 1, filtersApplied: true }
  if (isCheckboxFilterKey(CHECKBOX_FILTERS, key)) {
    next.selected = withoutCheckboxValue(filters.selected, key, value)
    return next
  }
  switch (key) {
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
 * labels are just the value ("England", "Reprocessor") — no
 * category prefix — except Sort, which keeps "Sorted by: {value}" since a
 * bare sort value reads ambiguously as a chip. Sort is included so the user
 * can revert to the default order without JavaScript (there is no explicit
 * "default" sort radio).
 */
/** The "Active filters" chip label for the assignment section, or `null`. */
function buildAssignmentChipLabel(filters, assignableUsers) {
  if (!filters.assigneeModeExplicit) {
    return null
  }
  if (filters.assigneeMode === ASSIGNEE_FILTER_MINE) {
    return 'Your applications'
  }
  if (filters.assigneeMode === ASSIGNEE_FILTER_UNASSIGNED) {
    return 'Unassigned'
  }
  if (filters.assigneeMode === ASSIGNEE_FILTER_USER && filters.assigneeUserId) {
    return assigneeUserName(filters.assigneeUserId, assignableUsers)
  }
  return null
}

function buildActiveFilters(filters, assignableUsers) {
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
  // "Reprocessor") — no "Nation:" / "Type:" category prefix,
  // since the category is inferable from the value itself. Sort is the sole
  // exception (kept below): a bare sort value ("Due date") reads ambiguously
  // as a chip, so it keeps its "Sorted by: " prefix. An option's `chip` can
  // still differ from its text (RA-681: "ORS applications").
  for (const chip of checkboxFilterChips(CHECKBOX_FILTERS, filters.selected)) {
    add(chip.key, chip.value, chip.label)
  }
  // RA-299 AC08/09. Only render the assignment chip for an EXPLICIT
  // selection — the silent "mine" default must not appear as a removable
  // chip (there'd be nothing meaningful to "remove" back to; the user just
  // wouldn't see a chip for the view they're already on).
  const assignmentChipLabel = buildAssignmentChipLabel(filters, assignableUsers)
  if (assignmentChipLabel) {
    add('assignment', null, assignmentChipLabel)
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
