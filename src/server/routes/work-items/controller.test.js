import { vi, beforeEach, afterEach } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { config } from '#/config/config.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getBackendHealth: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  addWorkItemNote: vi.fn()
}))

const { getWorkItems } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

function emptyPage(overrides = {}) {
  return {
    ok: true,
    items: [],
    totalCount: 0,
    page: 1,
    pageSize: 20,
    ...overrides
  }
}

describe('#workItemListController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItems.mockReset()
    // The plugin clears the registry on each createServer registration; tests
    // that need a known type must register it after server boot.
  })

  test('Renders the empty state when the backend has no items', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    // RA-324. The page is now titled "Applications" (the nav link stays
    // "Work items").
    expect(result).toEqual(expect.stringContaining('Applications |'))
    expect(result).toEqual(
      expect.stringContaining('No work items have been submitted yet.')
    )
  })

  test('Renders submitted items as tiles with type and state display names', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Not started' },
      states: [
        { id: 'submitted', displayName: 'Not started' },
        { id: 'approved', displayName: 'Granted', isTerminal: true }
      ],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: 'frontend',
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    // The tile is keyed by the work item id (href + testids).
    expect(result).toEqual(
      expect.stringContaining('11111111-1111-1111-1111-111111111111')
    )
    // Applicant type = the work-item type display name (AC05.5).
    expect(result).toEqual(expect.stringContaining('Re-accreditation'))
    // State badge text = the state display name (RA-324 contract label).
    expect(result).toEqual(expect.stringContaining('Not started'))
    // Status renders as a coloured govuk-tag (AC07/AC08); submitted = grey.
    expect(result).toEqual(
      expect.stringContaining(
        'data-testid="work-item-state-tag-11111111-1111-1111-1111-111111111111"'
      )
    )
    expect(result).toEqual(expect.stringContaining('govuk-tag govuk-tag--grey'))
    // Rendered as a tile, not the old table.
    expect(result).toEqual(
      expect.stringContaining('data-testid="application-tile"')
    )
    expect(result).not.toEqual(
      expect.stringContaining('data-testid="work-items-table"')
    )
  })

  // RA-196: the visible link text shows the user-facing application
  // reference (payload.applicationReference) while the href and the
  // data-testid keep using the internal work item id.
  test('Renders the application reference as the link text, keeping the id in the href and testid', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: 'frontend',
            payload: { applicationReference: 'RA-123456789' }
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    // Visible link text is the application reference.
    expect(result).toEqual(expect.stringContaining('>RA-123456789</a>'))
    // The href and data-testid keep the internal id.
    expect(result).toEqual(
      expect.stringContaining(
        'href="/work-items/11111111-1111-1111-1111-111111111111"'
      )
    )
    expect(result).toEqual(
      expect.stringContaining(
        'data-testid="work-item-link-11111111-1111-1111-1111-111111111111"'
      )
    )
  })

  // RA-249: the "Application ref" column must show the human RA-* reference
  // or NOTHING — never the work-item Guid. When applicationReference is
  // absent the link text is empty, but the href/data-testid keep the id so
  // navigation is preserved.
  test('RA-249: Application ref link text is empty (never the id) when applicationReference is missing, keeping the id in the href', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    const id = '22222222-2222-2222-2222-222222222222'
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id,
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: 'frontend',
            payload: { applicantName: 'Acme' } // No applicationReference
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    // The id must NOT be used as the visible link text.
    expect(result).not.toEqual(expect.stringContaining(`>${id}</a>`))
    // The href and data-testid still carry the id, so navigation works.
    expect(result).toEqual(expect.stringContaining(`href="/work-items/${id}"`))
    expect(result).toEqual(
      expect.stringContaining(`data-testid="work-item-link-${id}"`)
    )
    // RA-249 accessibility (WCAG 2.4.4): the visible cell stays blank, but
    // the link still has an accessible name via a visually-hidden fallback,
    // so it is never a text-less link.
    expect(result).toEqual(
      expect.stringContaining(
        `data-testid="work-item-link-${id}"><span class="govuk-visually-hidden">View application</span></a>`
      )
    )
  })

  // ---------------------------------------------------------------- //
  // RA-324 Applications tiles page                                    //
  //                                                                  //
  // AC04: applications render as tiles (not a table).                //
  // ---------------------------------------------------------------- //
  test('Renders applications as tiles, not the old table', async () => {
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    // Tiles container + one tile per application.
    expect(result).toContain('data-testid="applications-list"')
    expect(result).toContain('data-testid="application-tile"')
    // The old wide, horizontally-scrolling table is gone entirely.
    expect(result).not.toContain('data-testid="work-items-table"')
    expect(result).not.toContain('app-work-items__table-wrapper')
  })

  test('Renders "Submitted on" as a GDS date before assessment starts', async () => {
    // Use a January date (UK GMT = UTC+0) for timezone-stable assertions.
    // No slaState => the SLA clock has not started => assessment has not
    // started, so the "Submitted on" field renders (AC05.6), formatted to the
    // GDS date standard ("16 July 2026") — date only, no time.
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="submitted-on"')
    // Formatted GDS date must appear; no time component; raw ISO must not.
    expect(result).toContain('15 January 2026')
    expect(result).not.toContain('15 January 2026 at')
    expect(result).not.toContain('2026-01-15T10:00:00Z')
  })

  // RA-324 (AC05.3 + AC05.8). Once the SLA clock has started the tile shows
  // the Org ID and the Due date (SLA tag + remaining text) and HIDES the
  // Submitted-on field (assessment has started).
  test('Renders Org ID + Due date and hides Submitted on once the SLA clock has started', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            typeId: 'unknown-type',
            stateId: 'assessment-in-progress',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: 'frontend',
            slaState: 'OnTrack',
            slaRemaining: '14.00:00:00',
            payload: { operatorOrganisationId: 'ORG-4242' }
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    // Org ID field renders the payload value.
    expect(result).toContain('data-testid="org-id"')
    expect(result).toContain('ORG-4242')
    // Due date renders the SLA tag + remaining text.
    expect(result).toContain('data-testid="due-date"')
    expect(result).toContain('On track')
    expect(result).toContain('14 days remaining')
    // Submitted-on is suppressed while the SLA clock runs.
    expect(result).not.toContain('data-testid="submitted-on"')
  })

  // RA-324. When the SLA clock has started (slaState is truthy) but the value
  // is not a recognised SLA_TAG key, there is no tag to render — the Due date
  // cell must fall back to an em dash rather than being dropped. Using an
  // UNRECOGNISED slaState (not a real SLA_TAG key like 'Breached') is what
  // actually exercises the template's `{% else %}—{% endif %}` fallback.
  test('Renders an em dash in the Due date cell for an unrecognised SLA state', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'eeeeeeee-1111-1111-1111-111111111111',
            typeId: 'unknown-type',
            stateId: 'assessment-in-progress',
            submittedAt: null,
            submittedBy: null,
            slaState: 'Unknown',
            slaRemaining: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    // SLA clock started => due-date field is present, but with no recognised
    // tag the cell renders exactly an em dash.
    expect(result).toContain('data-testid="due-date">—</dd>')
    // Submitted-on is suppressed once the SLA clock has started.
    expect(result).not.toContain('data-testid="submitted-on"')
  })

  // RA-324. Sanity: a recognised SLA state DOES render its tag in the cell,
  // proving the previous test's em-dash is the fallback, not the default.
  test('Renders the SLA tag (not an em dash) in the Due date cell for Breached', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'eeeeeeee-3333-3333-3333-333333333333',
            typeId: 'unknown-type',
            stateId: 'assessment-in-progress',
            submittedAt: null,
            submittedBy: null,
            slaState: 'Breached',
            slaRemaining: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="due-date"')
    // Breached renders its red tag (no "remaining" text for a breach).
    expect(result).toContain('Breached')
    expect(result).not.toContain('data-testid="due-date">—</dd>')
  })

  // RA-324. An unparseable submittedAt (SLA clock not started) must render an
  // em dash, never "Invalid Date" — the `formatDateGds` filter returns '' for
  // a bad value, which the template's `or "—"` turns into an em dash.
  test('Renders an em dash for an unparseable submitted date', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'eeeeeeee-2222-2222-2222-222222222222',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: 'not-a-date',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="submitted-on"')
    expect(result).not.toContain('Invalid Date')
  })

  test('Renders in the constrained width with filter sidebar before the tiles', async () => {
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'aaaaaaaa-1111-1111-1111-111111111111',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    // RA-324 width fix: the page no longer widens the container to 1600 px —
    // it sits in the default GOV.UK width container and never scrolls sideways.
    expect(result).not.toContain('app-width-container--wide')
    // Filter sidebar (one-quarter) + tiles column (three-quarters) retained.
    expect(result).toContain('govuk-grid-column-one-quarter')
    expect(result).toContain('govuk-grid-column-three-quarters')
    // Filter form must appear before the tiles in document order.
    const filterIdx = result.indexOf('data-testid="work-items-filter-form"')
    const tilesIdx = result.indexOf('data-testid="applications-list"')
    expect(filterIdx).toBeGreaterThan(-1)
    expect(tilesIdx).toBeGreaterThan(filterIdx)
  })

  // RA-324 (AC08). Every registered state id maps to its contract badge
  // colour, and an unknown id falls back to the neutral grey tag. The colours
  // come from the shared state-badge map so the list and the detail page stay
  // consistent.
  test('Maps each registered state id to its RA-324 GOV.UK tag colour', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Not started' },
      states: [
        { id: 'submitted', displayName: 'Not started' },
        { id: 'duly-made', displayName: 'Duly made' },
        { id: 'assessment-in-progress', displayName: 'Updated' },
        { id: 'awaiting-decision', displayName: 'Awaiting decision' },
        { id: 'queried', displayName: 'Queried' },
        { id: 'updated', displayName: 'Updated' },
        { id: 'approved', displayName: 'Granted' },
        { id: 'rejected', displayName: 'Refused' },
        { id: 'withdrawn', displayName: 'Withdrawn' }
      ],
      getTasksForState: () => []
    })
    const states = [
      { stateId: 'submitted', cls: 'govuk-tag--grey' },
      { stateId: 'duly-made', cls: 'govuk-tag--blue' },
      { stateId: 'assessment-in-progress', cls: 'govuk-tag--light-blue' },
      { stateId: 'awaiting-decision', cls: 'govuk-tag--purple' },
      { stateId: 'queried', cls: 'govuk-tag--yellow' },
      { stateId: 'updated', cls: 'govuk-tag--light-blue' },
      { stateId: 'approved', cls: 'govuk-tag--green' },
      { stateId: 'rejected', cls: 'govuk-tag--red' },
      { stateId: 'withdrawn', cls: 'govuk-tag--grey' },
      { stateId: 'mystery', cls: 'govuk-tag--grey' }
    ]
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: states.map((s, i) => ({
          id: `00000000-0000-0000-0000-00000000000${i}`,
          typeId: 're-accreditation',
          stateId: s.stateId,
          submittedAt: '2026-04-27T10:00:00Z',
          submittedBy: 'frontend',
          payload: {}
        })),
        totalCount: states.length
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    // Each state's badge renders with its contract colour on its own tile.
    for (const [i, s] of states.entries()) {
      const id = `00000000-0000-0000-0000-00000000000${i}`
      const badgeIdx = result.indexOf(`data-testid="work-item-state-tag-${id}"`)
      expect(badgeIdx).toBeGreaterThan(-1)
      const badgeMarkup = result.slice(badgeIdx - 120, badgeIdx)
      expect(badgeMarkup).toContain(s.cls)
    }
    // The retired orange (RA-291 queried) colour is gone.
    expect(result).not.toContain('govuk-tag--orange')
  })

  test('Falls back to raw type id when no module is registered for the type', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            typeId: 'unknown-type',
            stateId: 'mystery',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('unknown-type'))
    expect(result).toEqual(expect.stringContaining('mystery'))
    // Empty submitter renders as an em-dash.
    expect(result).toEqual(expect.stringContaining('—'))
  })

  test('Renders an error banner when the backend cannot be reached', async () => {
    getWorkItems.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('Could not reach the backend')
    )
    expect(result).toEqual(expect.stringContaining('ECONNREFUSED'))
  })

  test('Forwards type, state, search and page filters to the backend', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [
        { id: 'submitted', displayName: 'Submitted' },
        { id: 'approved', displayName: 'Approved', isTerminal: true }
      ],
      getTasksForState: () => []
    })
    registerWorkItemType({
      id: 'other',
      displayName: 'Other',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(
      emptyPage({ totalCount: 0, page: 2, pageSize: 20 })
    )

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items?typeId=re-accreditation&typeId=other&stateId=approved&search=acme&page=2'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        typeIds: ['re-accreditation', 'other'],
        stateIds: ['approved'],
        search: 'acme',
        page: 2,
        pageSize: 20
      })
    )
  })

  test('Drops unknown type and state filter values', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?typeId=ghost&stateId=mystery&search=&page=0'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        typeIds: [],
        stateIds: [],
        search: '',
        page: 1,
        pageSize: 20
      })
    )
  })

  test('Renders a pagination block when there is more than one page', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 45,
        page: 2,
        pageSize: 20
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items?page=2'
    })

    // govuk-pagination renders a <nav class="govuk-pagination">.
    expect(result).toEqual(expect.stringContaining('govuk-pagination'))
    // Previous and next links preserve the page parameter.
    expect(result).toEqual(expect.stringContaining('href="/work-items"'))
    expect(result).toEqual(expect.stringContaining('href="/work-items?page=3"'))
    expect(result).toEqual(
      expect.stringContaining(
        'Showing page <strong>2</strong> of <strong>3</strong>'
      )
    )
  })

  test('Shows a filtered empty-state message when filters are active but nothing matches', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(emptyPage())

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items?typeId=re-accreditation'
    })

    expect(result).toEqual(
      expect.stringContaining('No work items match your filters.')
    )
    expect(result).toEqual(expect.stringContaining('Clear filters'))
  })

  test('Translates assigneeMode=mine into the signed-in user id', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=mine'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        // Default test user is the standard caseworker stub user.
        assigneeId: 'test-standard-id',
        unassigned: false
      })
    )
  })

  test('Translates assigneeMode=unassigned into unassigned=true', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=unassigned'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: null, unassigned: true })
    )
  })

  test('Translates assigneeMode=user with assigneeUserId into a backend assigneeId filter', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=user&assigneeUserId=u-9'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: 'u-9', unassigned: false })
    )
  })

  test('Drops unknown assigneeMode values silently', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=ghost'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: null, unassigned: false })
    )
  })

  test('Forwards the signed-in user to the backend client so identity headers are sent', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({ method: 'GET', url: '/work-items' })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: expect.any(String) })
      })
    )
  })

  // ---------------------------------------------------------------- //
  // XSS regression — epr-6fi.                                         //
  //                                                                  //
  // Nunjucks autoescape only kicks in for `{{ … }}` interpolations,  //
  // not for govuk macro `html:` parameters. The list page used to    //
  // concatenate the work-item id into a link's href / text and the   //
  // backend error message into the notification banner — both raw —  //
  // which let a malicious id or backend payload inject script tags.  //
  // ---------------------------------------------------------------- //
  test('Escapes work-item ids when rendering the list to prevent XSS', async () => {
    clearWorkItemRegistry()
    const malicious = '<script>alert(1)</script>'
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: malicious,
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toContain(malicious)
    expect(result).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    // href is URL-encoded, not just HTML-escaped, so the angle brackets
    // are %3C / %3E rather than &lt; / &gt;.
    expect(result).toContain(
      'href="/work-items/%3Cscript%3Ealert(1)%3C%2Fscript%3E"'
    )
  })

  test('Escapes the backend error message when the list banner renders', async () => {
    const malicious = '<img src=x onerror="alert(1)">'
    getWorkItems.mockResolvedValue({ ok: false, error: malicious })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('Could not reach the backend')
    expect(result).not.toContain(malicious)
    expect(result).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  describe('RA-127 create-work-item button', () => {
    const flagKey = 'featureFlags.workItemCreationEnabled'
    let originalFlag

    beforeEach(() => {
      originalFlag = config.get(flagKey)
      getWorkItems.mockResolvedValue(emptyPage())
    })

    afterEach(() => {
      config.set(flagKey, originalFlag)
    })

    test('renders the button when the flag is on', async () => {
      config.set(flagKey, true)
      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })
      expect(result).toEqual(
        expect.stringContaining('data-testid="work-items-create-link"')
      )
    })

    test('hides the button when the flag is off', async () => {
      config.set(flagKey, false)
      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="work-items-create-link"')
      )
    })
  })

  // ---------------------------------------------------------------- //
  // RA-125 — Nation filter                                            //
  // ---------------------------------------------------------------- //
  describe('RA-125 nation filter', () => {
    test('Forwards nation query params to the backend', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?nation=England&nation=Scotland'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['England', 'Scotland'] })
      )
    })

    test('Drops invalid nation values', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?nation=England&nation=Atlantis'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['England'] })
      )
    })

    test('Defaults to user nation role when user has exactly one nation role', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items',
        headers: { 'x-test-user-role': 'nation-scotland' }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['Scotland'] })
      )
    })

    test('No default nation when user has no nation roles', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      // Default assign user has no nation roles.
      await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: [] })
      )
    })

    test('Explicit query param overrides role-based nation default', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?nation=Wales',
        headers: { 'x-test-user-role': 'nation-england' }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['Wales'] })
      )
    })

    test('Regulator checkboxes appear in the rendered page with regulator body names', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).toContain('filter-nation')
      // Regulator body display names replace raw nation names
      expect(result).toContain('Environment Agency (EA)')
      expect(result).toContain('SEPA')
      expect(result).toContain('Natural Resources Wales (NRW)')
      expect(result).toContain('NIEA')
      // Filter section heading uses "Regulator" not "Nation"
      expect(result).toContain('Regulator')
    })

    test('Nation checkboxes reflect the active filter', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?nation=Wales'
      })

      // The Wales checkbox must actually carry the checked attribute, and
      // the unchecked nations must not. Match on the name="nation" inputs
      // emitted by the govukCheckboxes macro.
      const inputRe = /<input[^>]*name="nation"[^>]*>/g
      const inputs = result.match(inputRe) ?? []
      expect(inputs).toHaveLength(4)
      const walesInput = inputs.find((i) => i.includes('value="Wales"'))
      const englandInput = inputs.find((i) => i.includes('value="England"'))
      expect(walesInput).toMatch(/\bchecked\b/)
      expect(englandInput).not.toMatch(/\bchecked\b/)
    })

    test('Form submission with no nation boxes ticked clears the role-based default', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      // Nation-england user submits the filter form (filtersApplied=1) with
      // no nation boxes ticked: they want to see all nations, not be locked
      // back into England by the default-resolution path.
      await server.inject({
        method: 'GET',
        url: '/work-items?filtersApplied=1',
        headers: { 'x-test-user-role': 'nation-england' }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: [] })
      )
    })

    test('Bare GET still applies the role-based nation default', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      // No filtersApplied marker on the URL — this is a fresh navigation,
      // so the regulator's own queue should still be pre-selected.
      await server.inject({
        method: 'GET',
        url: '/work-items',
        headers: { 'x-test-user-role': 'nation-england' }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['England'] })
      )
    })

    test('Pagination links preserve filtersApplied so defaults do not silently re-apply', async () => {
      // Pagination is only rendered when at least one item is present, so
      // register a minimal type and return one item across multiple pages.
      clearWorkItemRegistry()
      registerWorkItemType({
        id: 're-accreditation',
        displayName: 'Re-accreditation',
        initialState: { id: 'submitted', displayName: 'Submitted' },
        states: [{ id: 'submitted', displayName: 'Submitted' }],
        getTasksForState: () => []
      })
      getWorkItems.mockResolvedValue({
        ok: true,
        items: [
          {
            id: '44444444-4444-4444-4444-444444444444',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 100,
        page: 1,
        pageSize: 20
      })

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?filtersApplied=1',
        headers: { 'x-test-user-role': 'nation-england' }
      })

      // The 'next' link (and any numbered page links) must carry the
      // filtersApplied marker so paginating doesn't snap back to the
      // role-based nation default. Allow either '&' or HTML-escaped '&amp;'.
      expect(result).toMatch(/href="[^"]*filtersApplied=1[^"]*"/)
    })

    test('hasFilters is true when nations filter is active', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?nation=England'
      })

      // The "Clear filters" link is only rendered when hasFilters=true.
      expect(result).toContain('Clear filters')
    })
  })

  // ---------------------------------------------------------------- //
  // RA-136 — Archive filter                                           //
  // ---------------------------------------------------------------- //
  describe('RA-136 archive filter', () => {
    test('Forwards includeArchived=true to the backend when the query param is set', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ includeArchived: true })
      )
    })

    test('Sends includeArchived=false when the query param is absent', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({ method: 'GET', url: '/work-items' })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ includeArchived: false })
      )
    })

    test('hasFilters is true when includeArchived is set', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true'
      })

      expect(result).toContain('Clear filters')
    })

    test('Renders archivedAt from extended-JSON $date shape as a human-readable date', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              typeId: 'unknown-type',
              stateId: 'approved',
              submittedAt: '2026-04-01T10:00:00Z',
              submittedBy: null,
              payload: { archivedAt: { $date: '2026-05-01T12:00:00Z' } }
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true'
      })

      expect(result).toContain('1 May 2026')
      expect(result).toContain(
        'data-testid="work-item-archived-at-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"'
      )
    })

    test('Renders archivedAt from a plain ISO-8601 string as a human-readable date', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
              typeId: 'unknown-type',
              stateId: 'approved',
              submittedAt: '2026-04-01T10:00:00Z',
              submittedBy: null,
              payload: { archivedAt: '2026-05-01T12:00:00Z' }
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true'
      })

      expect(result).toContain('1 May 2026')
      expect(result).toContain(
        'data-testid="work-item-archived-at-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"'
      )
    })

    test('Renders an em-dash for items with no archivedAt value', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
              typeId: 'unknown-type',
              stateId: 'submitted',
              submittedAt: '2026-04-01T10:00:00Z',
              submittedBy: null,
              payload: {}
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      // The Nunjucks `item.archivedAt or "—"` renders a dash when null.
      expect(result).toContain('—')
    })

    test('Pagination links preserve includeArchived so the filter survives page changes', async () => {
      clearWorkItemRegistry()
      registerWorkItemType({
        id: 're-accreditation',
        displayName: 'Re-accreditation',
        initialState: { id: 'submitted', displayName: 'Submitted' },
        states: [{ id: 'submitted', displayName: 'Submitted' }],
        getTasksForState: () => []
      })
      getWorkItems.mockResolvedValue({
        ok: true,
        items: [
          {
            id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-01T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 100,
        page: 1,
        pageSize: 20
      })

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true&filtersApplied=1'
      })

      expect(result).toMatch(/href="[^"]*includeArchived=true[^"]*"/)
    })
  })

  // Consumer contract test: this payload is a literal copy of the JSON
  // built by HttpCaseWorkingApiAdapter.BuildPayload in
  // epr-register-enrol-backend (the real operator submission), not a
  // hand-picked field. If the adapter's `material` field name ever drifts
  // from what decorate() reads here, this test fails instead of the
  // Material column silently going blank in production — which is exactly
  // what happened when the adapter sent `materialsHandled` while this table
  // read `payload.material`. Keep this fixture in sync with BuildPayload.
  test('Renders the material column from a real operator-backend submission payload', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-05-01T10:00:00Z',
            submittedBy: 'operator-fe',
            payload: {
              organisationName: 'Acme Recycling Ltd',
              registrationNumber: 'EPR-100023',
              material: 'plastic',
              accreditationYear: 2026,
              previousAccreditationYear: 2025,
              complianceIssuesReported: 0,
              siteAddress: '123 High Street, London, SW1A 1AA',
              siteAddressPostcode: 'SW1A 1AA',
              operatorApplicationId: 'app-001',
              operatorOrganisationId: '12345',
              operatorRegistrationId: 'reg-001',
              operatorEmail: 'jane@example.com'
            }
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Acme Recycling Ltd'))
    expect(result).toEqual(expect.stringContaining('plastic'))
  })
})
