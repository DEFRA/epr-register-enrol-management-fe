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
import { unwrapMongoDate } from '#/server/common/helpers/format/mongo-date.js'
import { config } from '#/config/config.js'
import { isExporterApplication } from './application-summary.js'

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
// param name/values are unchanged). Reprocessor keeps mapping to the real
// `re-accreditation` typeId (filters all current data — every work item
// submitted so far, reprocessor or exporter, has that same typeId, so this
// alone doesn't discriminate applicant kind).
//
// PR #179 review, resolved: a "Reprocessor" filter used to also return
// Exporter items, and a returned card could show a contradictory
// "(Exporter)" label under it, because `wasteProcessingTypes` was only ever
// narrowed for an Exporter-only selection. Fixed by also narrowing for a
// Reprocessor-only selection (see `wasteProcessingTypes` derivation in
// readFilters below) — checked against management-be#118's `BuildFilter`
// directly rather than guessing: any `WasteProcessingTypes` value other
// than a literal case-insensitive "exporter" is matched as `$not` of the
// exporter regex, which Mongo already matches against a MISSING field too.
// So a Reprocessor-only filter narrowed this way still includes pre-RA-314
// legacy items with no `wasteProcessingType` at all — the drop-legacy-items
// regression this was previously left unfixed to avoid does not occur.
//
// RA-412 gave the CARD LABEL and the applicant-kind derivation a real
// `payload.wasteProcessingType` field to read (see decorate() below and
// isExporterApplication() in application-summary.js, which decorate() also
// uses). The Exporter checkbox now reads from the SAME field via the
// backend's `WasteProcessingTypes` query param (management-be RA-412,
// mirroring the existing `Nations` filter) — see the `wasteProcessingTypes`
// derivation in readFilters below. `exporter` is never forwarded as a
// `typeId` itself (there is no such real typeId — there is only ever
// `re-accreditation` today); instead it is mapped onto `re-accreditation`
// (see the handler's `typeIds` merge below) alongside the
// `wasteProcessingTypes` narrowing, so an Exporter-only selection still
// carries a real type constraint even where the backend's
// `WasteProcessingTypes` support isn't deployed yet, rather than silently
// falling back to the full unfiltered list.
//
// The backend ANDs `typeIds` and `wasteProcessingTypes` (confirmed against
// management-be#118), so `wasteProcessingTypes` must only be sent when
// exactly one of Exporter/Reprocessor is selected — selecting BOTH
// checkboxes (or neither) is "either applicant kind", i.e. no
// wasteProcessingType narrowing at all, not an AND of the two (which would
// silently narrow to one kind and defeat the GDS checkbox-group OR
// semantics). See readFilters below.
//
// PR review (#179): this used to be two near-identical top-level constants
// ('exporter' and 'Exporter') disambiguated only by a comment. Bundled into
// one mapping so the UI/URL token and the backend wire value can't drift
// apart from each other silently.
const EXPORTER_TYPE_FILTER = {
  // UI/URL token for the Applicant type checkbox (`typeId=exporter`).
  typeIdToken: 'exporter',
  // Sent to the backend's `WasteProcessingTypes` filter param, matched
  // case-insensitively against `payload.wasteProcessingType` (see
  // isExporterApplication in application-summary.js). Confirmed against
  // management-be#118, which matches with a `^exporter$` regex and the `i`
  // flag — RA-314's operator-be itself writes the lowercase wire value
  // `"exporter"`, but this constant's casing does not need to mirror either
  // of those exactly given the case-insensitive match.
  wasteProcessingType: 'Exporter'
}

// Sent to the backend's `WasteProcessingTypes` filter param to narrow a
// Reprocessor-only Applicant-type selection — see the block comment above.
// management-be#118 has no dedicated "reprocessor" match: any value other
// than a literal case-insensitive "exporter" hits its `$not` branch, so this
// string's exact casing is arbitrary in the same way EXPORTER_TYPE_FILTER's
// comment describes, and it is what makes the filter include pre-RA-314
// items with no `wasteProcessingType` field (Mongo's `$not` on a `$regex`
// already matches a missing field).
const REPROCESSOR_WASTE_PROCESSING_TYPE = 'Reprocessor'

// The only work item typeId that exists on the backend today (see the
// APPLICATION_TYPE_FILTER_OPTIONS comment below).
const RE_ACCREDITATION_TYPE_ID = 're-accreditation'
const TYPE_FILTER_OPTIONS = [
  { value: RE_ACCREDITATION_TYPE_ID, text: 'Reprocessor reaccreditation' },
  { value: EXPORTER_TYPE_FILTER.typeIdToken, text: 'Exporter reaccreditation' }
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
  { value: RE_ACCREDITATION_TYPE_ID, text: 'Re-accreditation' },
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
// 'duly-made', and sub=false/due=true after 'payment-received'.
//
// The two dates are therefore gated on independent signals, and there is NO
// invariant about how many of them render. Both cases below are intended:
//   - BOTH render for a clock-carrying 'duly-made' item, i.e. the normal case
//     above. Correct: the submission date is still the relevant one to show,
//     and the clock genuinely is running, so the deadline is real.
//   - NEITHER renders for a post-'duly-made' item with no clock. This is a
//     live possibility, not just stale data: ReAccreditationSlaStampHook
//     catches WorkItemConcurrencyException, logs "clock may not be persisted"
//     and swallows it, so an item can reach 'assessment-in-progress' with no
//     clock at all. The footer then carries "Assigned to" alone, which is
//     better than inventing a date.
//
// KNOWN PARTIAL MISS (bead epr-r2s4, separate story): 'queried' and 'updated'
// are reachable from BOTH pre-assessment ('query-during-duly-making',
// 'query-during-duly-made') and post-assessment ('query-during-assessment',
// 'query-during-decision') transitions, so `stateId` alone cannot tell whether
// assessment ever started. Such items do not show "Submitted on" even when it
// never did. Resolving that needs the originating state; do not try to patch
// it here.
const PRE_ASSESSMENT_STATE_IDS = new Set(['submitted', 'duly-made'])

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
    const assignableUsers = await getAssignableUsers()

    const result = await getWorkItems({
      // RA-299 AC01/15. "Applicant type" and "Application type" are two
      // separate filter sections in the UI but both constrain the same
      // backend field — merge (and de-dup) the two selections here.
      // RA-412: `filters.typeIds` still carries the Exporter stub value for
      // checkbox/chip rendering, but it is never a real typeId — map it onto
      // `re-accreditation`, the one real typeId Exporter items actually carry
      // today. This keeps a genuine type constraint on an Exporter-only
      // selection (rather than sending an empty `typeIds`, which the backend
      // reads as "no type filter" and would return the full unfiltered list
      // until management-be#118's `wasteProcessingTypes` support is live —
      // see the EXPORTER_TYPE_FILTER comment above). Exporter's real
      // discrimination still comes from `wasteProcessingTypes` below.
      typeIds: [
        ...new Set([
          ...toBackendTypeIds(filters.typeIds),
          ...filters.applicationTypeIds
        ])
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
      // RA-412. Exporter's real discriminator (management-be matches this
      // against `payload.wasteProcessingType`, case-insensitively).
      wasteProcessingTypes: filters.wasteProcessingTypes,
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

/**
 * Translate the UI's Applicant-type filter tokens (already validated against
 * `ALLOWED_TYPE_IDS`) into real backend typeIds, mapping the Exporter stub
 * token onto `re-accreditation` — see the EXPORTER_TYPE_FILTER comment above.
 * Mirrors `toBackendMaterialTokens`' UI-token -> backend-token translation
 * shape (materials.js) for the same reason: a filter value with no typeId of
 * its own on the backend today.
 *
 * @param {string[]} typeIds
 * @returns {string[]}
 */
function toBackendTypeIds(typeIds) {
  return typeIds.map((id) =>
    id === EXPORTER_TYPE_FILTER.typeIdToken ? RE_ACCREDITATION_TYPE_ID : id
  )
}

function readFilters(query, user) {
  // Hidden form marker that lets the controller distinguish 'user
  // submitted the filter form' from 'fresh GET of /work-items'. Without
  // this, role-based defaults (e.g. nation) would silently re-apply when
  // the user explicitly cleared them (RA-125). Computed up-front: the
  // RA-299 sort/assignee defaults below need it too.
  const filtersApplied = query.filtersApplied === '1'

  // Type ("Applicant type" in the UI): only the two Type-filter values are
  // accepted (Reprocessor -> re-accreditation, Exporter -> exporter).
  const typeIds = uniqueStringList(query.typeId).filter((id) =>
    ALLOWED_TYPE_IDS.has(id)
  )

  // RA-412 (PR #179 review follow-up). The applicant-kind backend filter —
  // see the EXPORTER_TYPE_FILTER / REPROCESSOR_WASTE_PROCESSING_TYPE
  // comments above for why this is derived separately from `typeIds` rather
  // than forwarded as one. Only sent when exactly one of Exporter/Reprocessor
  // is selected: since the backend ANDs `typeIds` and `wasteProcessingTypes`,
  // sending it while BOTH (or neither) are selected would narrow the
  // combined "either applicant type" selection down to one kind — the
  // opposite of GDS checkbox-group OR semantics.
  const exporterSelected = typeIds.includes(EXPORTER_TYPE_FILTER.typeIdToken)
  const reprocessorSelected = typeIds.includes(RE_ACCREDITATION_TYPE_ID)
  const wasteProcessingTypes =
    exporterSelected === reprocessorSelected
      ? []
      : [
          exporterSelected
            ? EXPORTER_TYPE_FILTER.wasteProcessingType
            : REPROCESSOR_WASTE_PROCESSING_TYPE
        ]

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
    wasteProcessingTypes,
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
  if (value == null) {
    return []
  }
  const list = Array.isArray(value) ? value : [value]
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') {
      continue
    }
    const trimmed = item.trim()
    if (trimmed === '' || seen.has(trimmed)) {
      continue
    }
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
    // RA-295 AC06. The operator's registration number on each card. NOTE:
    // this is `registrationNumber` (e.g. "EPR-100999") — deliberately NOT
    // `operatorRegistrationId` (e.g. "reg-008", RA-223's "Registration ID"),
    // which is a different field with a confusingly similar name.
    registrationNumber: item.payload?.registrationNumber ?? null,
    // RA-324. Present the material DISPLAY LABEL on the card (e.g. "Plastic",
    // "Fibre-based composite material"), matching the filter checkboxes,
    // active-filter chips and summary — never the raw lowercase token.
    material: materialLabel(item.payload?.material),
    // RA-412. The card's applicant-type label — see the comment above.
    applicantType,
    // The two card dates are gated INDEPENDENTLY — see the block comment above
    // PRE_ASSESSMENT_STATE_IDS for why, and for the cases where both or
    // neither render.
    showDueDate: slaStarted,
    showSubmittedOn: PRE_ASSESSMENT_STATE_IDS.has(stateId),
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
  // withoutFilter / buildPagination), so every list field is guaranteed to be
  // an array — no nullish guards needed on the loops.
  const params = new URLSearchParams()
  for (const id of filters.typeIds) {
    params.append('typeId', id)
  }
  for (const id of filters.applicationTypeIds) {
    params.append('applicationType', id)
  }
  for (const v of filters.statusGroups) {
    params.append('status', v)
  }
  for (const n of filters.nations) {
    params.append('nation', n)
  }
  for (const m of filters.materials) {
    params.append('material', m)
  }
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
