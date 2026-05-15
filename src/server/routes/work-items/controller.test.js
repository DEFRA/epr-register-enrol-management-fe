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
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  addWorkItemNote: vi.fn(),
  addWorkItemTaskNote: vi.fn()
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
    expect(result).toEqual(expect.stringContaining('Work items |'))
    expect(result).toEqual(
      expect.stringContaining('No work items have been submitted yet.')
    )
  })

  test('Renders submitted items in a table with type and state display names', async () => {
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
    expect(result).toEqual(
      expect.stringContaining('11111111-1111-1111-1111-111111111111')
    )
    expect(result).toEqual(expect.stringContaining('Re-accreditation'))
    expect(result).toEqual(expect.stringContaining('Submitted'))
    expect(result).toEqual(expect.stringContaining('frontend'))
    // State column renders as a coloured govuk-tag matching the design
    // tokens used by the work item detail page (epr-3x2 follow-up).
    expect(result).toEqual(
      expect.stringContaining(
        'data-testid="work-item-state-tag-11111111-1111-1111-1111-111111111111"'
      )
    )
    expect(result).toEqual(expect.stringContaining('govuk-tag govuk-tag--blue'))
  })

  test('Maps each registered state id to its GOV.UK tag colour', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [
        { id: 'submitted', displayName: 'Submitted' },
        {
          id: 'assessment-in-progress',
          displayName: 'Assessment in progress'
        },
        { id: 'awaiting-decision', displayName: 'Awaiting decision' },
        { id: 'approved', displayName: 'Approved' },
        { id: 'rejected', displayName: 'Rejected' },
        { id: 'withdrawn', displayName: 'Withdrawn' }
      ],
      getTasksForState: () => []
    })
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          { stateId: 'submitted' },
          { stateId: 'assessment-in-progress' },
          { stateId: 'awaiting-decision' },
          { stateId: 'approved' },
          { stateId: 'rejected' },
          { stateId: 'withdrawn' },
          { stateId: 'mystery' }
        ].map((s, i) => ({
          id: `00000000-0000-0000-0000-00000000000${i}`,
          typeId: 're-accreditation',
          submittedAt: '2026-04-27T10:00:00Z',
          submittedBy: 'frontend',
          payload: {},
          ...s
        })),
        totalCount: 7
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    for (const cls of [
      'govuk-tag--blue',
      'govuk-tag--light-blue',
      'govuk-tag--yellow',
      'govuk-tag--green',
      'govuk-tag--red',
      'govuk-tag--grey'
    ]) {
      expect(result).toEqual(expect.stringContaining(cls))
    }
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
        // Default test user is the assign-role stub user.
        assigneeId: 'test-assign-id',
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

    test('Nation checkboxes appear in the rendered page', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).toContain('filter-nation')
      expect(result).toContain('England')
      expect(result).toContain('Scotland')
      expect(result).toContain('Wales')
      expect(result).toContain('Northern Ireland')
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
})
