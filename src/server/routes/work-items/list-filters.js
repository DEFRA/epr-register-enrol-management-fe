import { IN_YEAR_CHANGE_CATEGORY } from '#/server/work-items/core/categories.js'
import { NATION_OPTIONS } from '#/server/work-items/core/nations.js'
import {
  MATERIAL_FILTER_OPTIONS,
  toBackendMaterialTokens
} from '#/server/work-items/core/materials.js'
import { NATION_ROLE_MAP } from '#/server/common/helpers/auth/auth-scopes.js'

// "Applicant type" (RA-324, relabelled by RA-299): who is applying, the
// accreditation's own waste processing type. Every work item type carries it
// as `payload.wasteProcessingType`, so it is sent only as the backend's
// `wasteProcessingTypes` filter, which narrows whatever "Application type"
// selected (RA-739: it used to add a `re-accreditation` typeId, which widened
// an In-year change selection and hid add-ORS items from an Exporter one).
// The URL keeps its RA-324 values: `typeId=re-accreditation` is Reprocessor
// and `typeId=exporter` is Exporter.
//
// management-be matches "exporter" case-insensitively and treats any other
// value as "not exporter", which includes pre-RA-314 items with no
// `wasteProcessingType` (read everywhere as reprocessor). So it is sent only
// when exactly one of the two is ticked: both, or neither, is "either
// applicant type" (GDS checkbox-group OR), not a narrowing to one kind.
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

// The re-accreditation work item typeId; also the Reprocessor URL value.
const RE_ACCREDITATION_TYPE_ID = 're-accreditation'
const TYPE_FILTER_OPTIONS = [
  { value: RE_ACCREDITATION_TYPE_ID, text: 'Reprocessor' },
  { value: EXPORTER_TYPE_FILTER.typeIdToken, text: 'Exporter' }
]

// RA-299 AC01/15. A SECOND, distinct type-style filter: "Application type"
// (what kind of application it is), separate from "Applicant type" (who is
// applying) above. It alone sets the backend's `typeIds`, submitted via a
// separate `applicationType=` query param so the two checkbox groups don't
// collide in the form / active-filter chips.
// "Re-accreditation" maps to the real `re-accreditation` typeId;
// "Accreditation", "Registration application" and
// "Payment of annual registration fee" are BA-requested options with no
// backend type yet, so they are given not-yet-existing typeId tokens and
// correctly return zero results via the backend's `builder.In(w => w.TypeId,
// typeIds)` until those work item types exist.
//
// RA-739. "In-year change" is a CATEGORY, not a typeId: it is sent as
// `category=in-year-change` and management-be expands it to every type
// registered with that category (add-ORS now, update ORS / tonnage band
// upgrade later), unioned with the typeIds.
const APPLICATION_TYPE_FILTER_OPTIONS = [
  { value: RE_ACCREDITATION_TYPE_ID, text: 'Re-accreditation' },
  { value: 'accreditation', text: 'Accreditation' },
  { value: 'registration-application', text: 'Registration application' },
  {
    value: 'annual-fee-payment',
    text: 'Payment of annual registration fee'
  },
  { value: IN_YEAR_CHANGE_CATEGORY, text: 'In-year change', isCategory: true }
]
const APPLICATION_TYPE_CATEGORIES = new Set(
  APPLICATION_TYPE_FILTER_OPTIONS.filter((o) => o.isCategory).map(
    (o) => o.value
  )
)

// RA-681. The "In-year change" section narrows the in-year change part of the
// results to particular kinds of change (see resolveTypeFilter). Each option
// lists the work item typeIds it stands for, so it is sent as `typeIds`, not
// as the `in-year-change` category. Types case management doesn't have yet
// are given the typeIds agreed for them, which match nothing until they exist:
// `upgrade-tonnage-band` (the operator's change type value),
// `add-new-overseas-site` (a brand-new ORS) and `withdraw-overseas-site`.
// SIP is phase 2. The ORS option's typeIds are every ORS management option's,
// so the two sections can't drift apart.
const IN_YEAR_CHANGE_ORS = 'ors'

// RA-681. The "ORS management" section narrows the ORS part of the in-year
// change results to kinds of ORS change (see resolveTypeFilter). Option text
// is Figma's; `chip` is prefixed so it can't be confused with the page
// heading "Applications" or the "Withdrawn" status chip. Applications covers
// a brand-new ORS (`add-new-overseas-site`, not built yet) and adding an
// existing registered ORS (`add-overseas-site`). `withdraw-overseas-site` is
// a placeholder that matches nothing until that type exists.
const ORS_MANAGEMENT_FILTER_OPTIONS = [
  {
    value: 'applications',
    text: 'Applications',
    chip: 'ORS applications',
    typeIds: ['add-new-overseas-site', 'add-overseas-site']
  },
  {
    value: 'withdrawals',
    text: 'Withdrawals',
    chip: 'ORS withdrawals',
    typeIds: ['withdraw-overseas-site']
  },
  {
    value: 'updates',
    text: 'Updates (detail changes)',
    chip: 'ORS updates (detail changes)',
    typeIds: ['update-overseas-site']
  }
]
const ORS_MANAGEMENT_OPTION_BY_VALUE = new Map(
  ORS_MANAGEMENT_FILTER_OPTIONS.map((o) => [o.value, o])
)

const IN_YEAR_CHANGE_FILTER_OPTIONS = [
  { value: 'tonnage', text: 'Tonnage', typeIds: ['upgrade-tonnage-band'] },
  {
    value: IN_YEAR_CHANGE_ORS,
    text: 'ORS',
    typeIds: ORS_MANAGEMENT_FILTER_OPTIONS.flatMap((o) => o.typeIds)
  }
]
const IN_YEAR_CHANGE_OPTION_BY_VALUE = new Map(
  IN_YEAR_CHANGE_FILTER_OPTIONS.map((o) => [o.value, o])
)

// RA-324 phase-2. The "Status" filter groups the backend state ids under the
// AC06 labels. The single "Updated" option deliberately expands to BOTH
// `assessment-in-progress` and `updated` (they share the "Updated" label), so
// the UI shows one checkbox while the backend receives both state ids. The
// `value` is the stable UI/URL token (submitted via `status=`), decoupled from
// the raw `stateId` backend param.
//
// RA-527 follow-up. "Duly made" likewise expands to `duly-made` AND
// `assessment-started` (a started case, which still reads "Duly made"), so a
// started case is found under "Duly made" and never under "Updated".
const STATUS_FILTER_OPTIONS = [
  { value: 'submitted', text: 'Not started', stateIds: ['submitted'] },
  {
    value: 'duly-made',
    text: 'Duly made',
    stateIds: ['duly-made', 'assessment-started']
  },
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
  // RA-527. Approved at step 1, applicant not yet contacted. Its own option,
  // separate from "Granted".
  {
    value: 'approved-pending-contact',
    text: 'Approved',
    stateIds: ['approved-pending-contact']
  },
  { value: 'approved', text: 'Granted', stateIds: ['approved'] },
  // RA-527. A step 1 refusal (`rejected-pending-contact`) reads "Refused",
  // the same as the final `rejected` state, so the one "Refused" option
  // covers both, as "Updated" does above.
  {
    value: 'rejected',
    text: 'Refused',
    stateIds: ['rejected', 'rejected-pending-contact']
  },
  { value: 'withdrawn', text: 'Withdrawn', stateIds: ['withdrawn'] }
]
const STATUS_OPTION_BY_VALUE = new Map(
  STATUS_FILTER_OPTIONS.map((o) => [o.value, o])
)

/**
 * RA-412. The backend filter for Applicant type: only when exactly one of
 * Exporter/Reprocessor is ticked (see EXPORTER_TYPE_FILTER above).
 */
function wasteProcessingTypesFor(typeIds) {
  const exporterSelected = typeIds.includes(EXPORTER_TYPE_FILTER.typeIdToken)
  const reprocessorSelected = typeIds.includes(RE_ACCREDITATION_TYPE_ID)
  if (exporterSelected === reprocessorSelected) {
    return []
  }
  return [
    exporterSelected
      ? EXPORTER_TYPE_FILTER.wasteProcessingType
      : REPROCESSOR_WASTE_PROCESSING_TYPE
  ]
}

/**
 * RA-125. The Nation filter's default when none is submitted: the user's
 * nation when they have exactly one nation role, so regulators see their own
 * queue first. A submitted filter form with every nation unchecked is
 * honoured as "all nations", so they can see another nation's queue.
 */
function defaultNations({ user, filtersApplied }) {
  if (filtersApplied) {
    return []
  }
  const nationRoles = (user?.roles ?? []).filter((r) =>
    Object.hasOwn(NATION_ROLE_MAP, r)
  )
  return nationRoles.length === 1 ? [NATION_ROLE_MAP[nationRoles[0]]] : []
}

/**
 * The Applications list's checkbox filters (see checkbox-filters.js for the
 * descriptor shape). Their order is the order of the params in links and of
 * the active-filter chips; index.njk places each section on the page.
 *
 * Application type, In-year change and ORS management have no `toRequest`:
 * between them they set the backend's `typeIds` and `categories`, so they
 * are resolved together by resolveTypeFilter.
 */
export const CHECKBOX_FILTERS = [
  {
    // RA-299: "Applicant type", formerly "Type"; the `typeId=` param is kept.
    key: 'type',
    param: 'typeId',
    title: 'Applicant type',
    options: TYPE_FILTER_OPTIONS,
    toRequest: (values) => ({
      wasteProcessingTypes: wasteProcessingTypesFor(values)
    })
  },
  {
    key: 'applicationType',
    title: 'Application type',
    options: APPLICATION_TYPE_FILTER_OPTIONS
  },
  {
    key: 'inYearChange',
    title: 'In-year change',
    options: IN_YEAR_CHANGE_FILTER_OPTIONS
  },
  {
    key: 'orsManagement',
    title: 'ORS management',
    options: ORS_MANAGEMENT_FILTER_OPTIONS
  },
  {
    // Status is a UI grouping over backend state ids: "Updated", "Duly made"
    // and "Refused" each expand to two ids.
    key: 'status',
    title: 'Status',
    options: STATUS_FILTER_OPTIONS,
    toRequest: (values) => ({
      stateIds: [
        ...new Set(
          values.flatMap((v) => STATUS_OPTION_BY_VALUE.get(v).stateIds)
        )
      ]
    })
  },
  {
    // RA-324 phase-2. The shared NATION_OPTIONS (RA-526), whose values are
    // NATION_ROLE_MAP's nations, with the RA-125 role-based default.
    key: 'nation',
    title: 'Nation',
    options: NATION_OPTIONS,
    defaultValues: defaultNations,
    toRequest: (values) => ({ nations: values })
  },
  {
    // Lower-cased, so `?material=Plastic&material=plastic` is one chip.
    // RA-299 AC05. The values are UI filter values (e.g. the split
    // 'glass-remelt' / 'glass-other'), sent as the real backend tokens.
    key: 'material',
    title: 'Material',
    options: MATERIAL_FILTER_OPTIONS,
    normalise: (value) => value.toLowerCase(),
    toRequest: (values) => ({ materials: toBackendMaterialTokens(values) })
  }
]

/**
 * The backend's `typeIds` and `categories` list params, from the type-style
 * filter sections. Applicant type is not one of them: it narrows these
 * through `wasteProcessingTypes`.
 *
 * RA-681. The "In-year change" and "ORS management" sections narrow only
 * the in-year change part of Application type:
 *   - Application type ticked without "In-year change": they are ignored.
 *   - Nothing ticked in either: the request is as before RA-681.
 *   - Otherwise the narrowed in-year typeIds (see narrowedInYearChangeTypeIds)
 *     replace the `in-year-change` category, and an empty Application type
 *     counts as every option ticked.
 *
 * @param {Record<string, string[]>} selected the checkbox filters' values
 */
export function resolveTypeFilter(selected) {
  const { applicationType, inYearChange, orsManagement } = selected
  const inYearChangeApplies =
    applicationType.length === 0 ||
    applicationType.includes(IN_YEAR_CHANGE_CATEGORY)
  const inYearChangeNarrowed =
    inYearChange.length > 0 || orsManagement.length > 0
  if (inYearChangeApplies && inYearChangeNarrowed) {
    const selectedApplicationTypes =
      applicationType.length > 0
        ? applicationType
        : APPLICATION_TYPE_FILTER_OPTIONS.map((o) => o.value)
    return {
      typeIds: [
        ...selectedApplicationTypes.filter(
          (id) => !APPLICATION_TYPE_CATEGORIES.has(id)
        ),
        ...narrowedInYearChangeTypeIds(inYearChange, orsManagement)
      ],
      categories: []
    }
  }
  return {
    // RA-299 AC01/15. The Application type options that are typeIds.
    typeIds: applicationType.filter(
      (id) => !APPLICATION_TYPE_CATEGORIES.has(id)
    ),
    // RA-739. Category options ("In-year change") are expanded to typeIds by
    // the backend and unioned with `typeIds` above.
    categories: applicationType.filter((id) =>
      APPLICATION_TYPE_CATEGORIES.has(id)
    )
  }
}

/**
 * RA-681. The in-year typeIds the two sub-sections select. An empty section
 * counts as every option ticked. "ORS management" narrows only the ORS
 * option, so Tonnage is never narrowed by it.
 */
function narrowedInYearChangeTypeIds(inYearChange, orsManagement) {
  const included =
    inYearChange.length > 0
      ? inYearChange
      : IN_YEAR_CHANGE_FILTER_OPTIONS.map((o) => o.value)
  return included.flatMap((v) =>
    v === IN_YEAR_CHANGE_ORS && orsManagement.length > 0
      ? orsManagement.flatMap(
          (o) => ORS_MANAGEMENT_OPTION_BY_VALUE.get(o).typeIds
        )
      : IN_YEAR_CHANGE_OPTION_BY_VALUE.get(v).typeIds
  )
}
