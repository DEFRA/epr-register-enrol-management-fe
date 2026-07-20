import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { clearDetailTemplateRegistry } from '#/server/work-items/core/templates.js'
import {
  ENTER_REASON_MESSAGE,
  QUERY_REASON_MAX_WORDS,
  QUERY_SECTION_OPTIONS,
  REASON_TOO_LONG_MESSAGE,
  SELECT_SECTIONS_MESSAGE
} from './query.schema.js'
import { hasQueryAction, isQueryActionId } from './query.controller.js'
import { reAccreditationType } from '#/server/work-items/re-accreditation/module.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', async () => {
  const actual = await vi.importActual(
    '#/server/common/helpers/backend-api/backend-api.js'
  )
  return {
    ...actual,
    getWorkItem: vi.fn(),
    getWorkItems: vi.fn(),
    raiseWorkItemQuery: vi.fn()
  }
})

const { getWorkItem, raiseWorkItemQuery } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '33333333-3333-3333-3333-333333333333'
const REF = 'RA-987654321'
const DETAIL_HREF = `/work-items/${ID}`
const QUERY_HREF = `/work-items/${ID}/query`

const queryAction = { actionId: 'query-submitted', displayName: 'Query' }

function aWorkItem(overrides = {}) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    stateDisplayName: 'Submitted',
    submittedAt: '2026-04-27T10:00:00Z',
    lastModifiedAt: '2026-04-27T10:05:00Z',
    submittedBy: 'frontend',
    templateVersion: 'v1',
    payload: { applicationReference: REF },
    tasks: [],
    availableActions: [queryAction],
    auditLog: [],
    ...overrides
  }
}

function form({
  sections = ['business-plan'],
  reason = 'Please clarify'
} = {}) {
  return [
    ...sections.map((s) => `sections=${encodeURIComponent(s)}`),
    `reason=${encodeURIComponent(reason)}`
  ].join('&')
}

const urlencoded = { 'content-type': 'application/x-www-form-urlencoded' }

function postQuery(server, payload) {
  return injectWithCrumb(server, {
    method: 'POST',
    url: QUERY_HREF,
    headers: urlencoded,
    payload
  })
}

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

describe('query action id helpers', () => {
  test('recognises query and query-<state> action ids', () => {
    expect(isQueryActionId('query')).toBe(true)
    expect(isQueryActionId('query-submitted')).toBe(true)
  })

  test('rejects anything else', () => {
    expect(isQueryActionId('withdraw')).toBe(false)
    expect(isQueryActionId('queried')).toBe(false)
    expect(isQueryActionId(undefined)).toBe(false)
    expect(isQueryActionId(null)).toBe(false)
    expect(isQueryActionId(42)).toBe(false)
  })

  test('hasQueryAction tolerates missing or malformed availableActions', () => {
    expect(hasQueryAction(undefined)).toBe(false)
    expect(hasQueryAction({})).toBe(false)
    expect(hasQueryAction({ availableActions: 'nope' })).toBe(false)
    expect(hasQueryAction({ availableActions: [null] })).toBe(false)
    expect(hasQueryAction({ availableActions: [{ actionId: 'query' }] })).toBe(
      true
    )
  })
})

describe('RA-291 Query link on the work item detail page', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    clearWorkItemRegistry()
    clearDetailTemplateRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })
    getWorkItem.mockReset()
  })

  test('renders a Query link when a query action is available', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DETAIL_HREF
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('data-testid="action-query"')
    )
    expect(result).toEqual(expect.stringContaining(`href="${QUERY_HREF}"`))
  })

  test('renders the link as a link, not a button', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { result } = await server.inject({ method: 'GET', url: DETAIL_HREF })

    expect(result).toMatch(/<a class="govuk-link"\s+data-testid="action-query"/)
  })

  test('hides the Query link when no query action is available', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        availableActions: [{ actionId: 'withdraw', displayName: 'Withdraw' }]
      })
    })

    const { result } = await server.inject({ method: 'GET', url: DETAIL_HREF })

    expect(result).not.toEqual(
      expect.stringContaining('data-testid="action-query"')
    )
  })
})

describe('RA-291 detail template resolves for the current templateVersion', () => {
  let server

  beforeEach(async () => {
    // Build the server per-test so the work-item plugin performs its real
    // module registration (it clears and repopulates both registries at
    // boot) rather than inheriting state cleared by another describe.
    server = await createServer()
    await server.initialize()
    getWorkItem.mockReset()
  })

  afterEach(async () => {
    await server.stop({ timeout: 0 })
  })

  test('an item stamped with the backend-current version renders the type-specific detail view', async () => {
    // Mirrors what the running stack showed: a v6-stamped item was
    // falling through to the generic template, silently losing the
    // re-accreditation approve CTA and actions panel.
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        templateVersion: reAccreditationType.templateVersion,
        availableActions: []
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DETAIL_HREF
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('data-testid="re-accreditation-detail"')
    )
  })
})

describe('RA-291 queried state renders its display name (bug: raw state id)', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    clearWorkItemRegistry()
    clearDetailTemplateRegistry()
    // Deliberately registers the REAL module rather than a hand-rolled
    // type: the bug was a state missing from the real STATES array, which
    // a bespoke fixture type would never have caught.
    registerWorkItemType(reAccreditationType)
    getWorkItem.mockReset()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ stateId: 'queried', availableActions: [] })
    })
  })

  test('the detail page State row shows "Queried", not "queried"', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DETAIL_HREF
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Queried'))
  })

  test('the audit log entry State row shows "Queried"', async () => {
    // The audit log surfaces the state label in each entry's "Show
    // details" disclosure, so the item needs at least one entry for the
    // row to exist at all.
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        stateId: 'queried',
        availableActions: [],
        auditLog: [
          {
            id: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            action: 'state-changed',
            at: '2026-04-27T10:05:00Z',
            by: 'alice'
          }
        ]
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `${DETAIL_HREF}/audit-log`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Queried'))
  })
})

describe('GET /work-items/{id}/query', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItem.mockReset()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
  })

  test('renders the query form with all six section checkboxes', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: QUERY_HREF
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('data-testid="query-form"'))
    for (const option of QUERY_SECTION_OPTIONS) {
      expect(result).toEqual(expect.stringContaining(`value="${option.value}"`))
      expect(result).toEqual(expect.stringContaining(option.text))
    }
  })

  test('renders the page copy, word limit, inset text and cancel link', async () => {
    const { result } = await server.inject({ method: 'GET', url: QUERY_HREF })

    expect(result).toEqual(
      expect.stringContaining('Which areas do you want to query?')
    )
    expect(result).toEqual(expect.stringContaining('Reason for the query'))
    expect(result).toEqual(
      expect.stringContaining(
        'This will be included in the email to the operator.'
      )
    )
    expect(result).toEqual(
      expect.stringContaining('data-testid="query-assignment-notice"')
    )
    expect(result).toEqual(expect.stringContaining('data-testid="query-lead"'))
    expect(result).toEqual(
      expect.stringContaining(`data-maxwords="${QUERY_REASON_MAX_WORDS}"`)
    )
    expect(result).toEqual(expect.stringContaining(`href="${DETAIL_HREF}"`))
    expect(result).toEqual(expect.stringContaining(REF))
  })

  // RA-323: every caseworker holds the same role, so the query page is
  // reachable by any authenticated user regardless of nation scope — there
  // is no longer an 'assign' role to gate on.
  test.each(['standard', 'nation-england'])(
    'is reachable by a %s user',
    async (role) => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: QUERY_HREF,
        headers: { 'x-test-user-role': role }
      })

      expect(statusCode).toBe(statusCodes.ok)
    }
  )

  test('carries a CSRF crumb on the form', async () => {
    const { result } = await server.inject({ method: 'GET', url: QUERY_HREF })

    expect(result).toMatch(/name="crumb" value="[^"]+"/)
  })

  test('redirects with a banner when the item cannot be queried', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ availableActions: [] })
    })

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: QUERY_HREF
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(DETAIL_HREF)
  })

  test('renders without a caption when the item has no application reference', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ payload: undefined })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: QUERY_HREF
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('data-testid="query-form"'))
    expect(result).not.toEqual(expect.stringContaining(REF))
  })

  test('renders 404 when the work item does not exist', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: QUERY_HREF
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Work item not found'))
  })

  test('renders 502 when the backend is unavailable', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 503, error: 'boom' })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: QUERY_HREF
    })

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(result).toEqual(expect.stringContaining('Work item unavailable'))
  })

  test('renders 502 without an error string when the backend gives none', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 500 })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: QUERY_HREF
    })

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(result).toEqual(expect.stringContaining('Backend returned 500'))
  })
})

describe('POST /work-items/{id}/query', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItem.mockReset()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    raiseWorkItemQuery.mockReset()
  })

  test('sends the query and redirects to the detail page on success', async () => {
    raiseWorkItemQuery.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, headers } = await postQuery(
      server,
      form({
        sections: ['business-plan', 'prn-tonnage'],
        reason: 'Tonnage does not add up'
      })
    )

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(DETAIL_HREF)
    expect(raiseWorkItemQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        sections: ['business-plan', 'prn-tonnage'],
        reason: 'Tonnage does not add up'
      })
    )
  })

  test('shows a success banner on the detail page after the redirect', async () => {
    raiseWorkItemQuery.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const post = await postQuery(server, form())
    const session = [].concat(post.headers['set-cookie'] ?? []).join('; ')

    const detail = await server.inject({
      method: 'GET',
      url: DETAIL_HREF,
      headers: { cookie: session }
    })

    expect(detail.result).toEqual(expect.stringContaining('Query sent'))
  })

  test('normalises a single checkbox posted as a bare string', async () => {
    raiseWorkItemQuery.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    await postQuery(server, form({ sections: ['authority-to-issue'] }))

    expect(raiseWorkItemQuery).toHaveBeenCalledWith(
      expect.objectContaining({ sections: ['authority-to-issue'] })
    )
  })

  test('rejects a submission with no sections selected', async () => {
    const { statusCode, result } = await postQuery(
      server,
      'reason=Some%20reason'
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining(SELECT_SECTIONS_MESSAGE))
    expect(result).toEqual(expect.stringContaining('href="#field-sections"'))
    expect(result).toEqual(expect.stringContaining('Error: Query'))
    expect(raiseWorkItemQuery).not.toHaveBeenCalled()
  })

  test('rejects a submission with no reason', async () => {
    const { statusCode, result } = await postQuery(
      server,
      'sections=business-plan'
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining(ENTER_REASON_MESSAGE))
    expect(result).toEqual(expect.stringContaining('href="#field-reason"'))
    expect(raiseWorkItemQuery).not.toHaveBeenCalled()
  })

  test('rejects a whitespace-only reason', async () => {
    const { statusCode, result } = await postQuery(
      server,
      form({ reason: '    ' })
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining(ENTER_REASON_MESSAGE))
  })

  test(`accepts a reason of exactly ${QUERY_REASON_MAX_WORDS} words`, async () => {
    raiseWorkItemQuery.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode } = await postQuery(
      server,
      form({ reason: words(QUERY_REASON_MAX_WORDS) })
    )

    expect(statusCode).toBe(statusCodes.redirect)
  })

  test(`rejects a reason of ${QUERY_REASON_MAX_WORDS + 1} words`, async () => {
    const { statusCode, result } = await postQuery(
      server,
      form({ reason: words(QUERY_REASON_MAX_WORDS + 1) })
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining(REASON_TOO_LONG_MESSAGE))
    expect(raiseWorkItemQuery).not.toHaveBeenCalled()
  })

  test('re-renders the form with the user input preserved', async () => {
    const { result } = await postQuery(
      server,
      form({ sections: ['prn-tonnage'], reason: '' })
    )

    expect(result).toMatch(/value="prn-tonnage"[^>]*checked/)
  })

  test('re-renders validation errors when the item has no application reference', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ payload: undefined })
    })

    const { statusCode, result } = await postQuery(server, 'reason=')

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining(SELECT_SECTIONS_MESSAGE))
    expect(result).not.toEqual(expect.stringContaining(REF))
  })

  test('still renders the error page when the work item lookup also fails', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 503 })

    const { statusCode, result } = await postQuery(server, 'reason=')

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining(SELECT_SECTIONS_MESSAGE))
  })

  test.each([
    [400, 'invalid'],
    [403, 'not-authorized'],
    [404, 'not-found'],
    [409, 'not-allowed'],
    [500, 'server']
  ])(
    'redirects with an error banner when the backend returns %i',
    async (status, reason) => {
      raiseWorkItemQuery.mockResolvedValue({
        ok: false,
        reason,
        status,
        message: 'backend said no'
      })

      const post = await postQuery(server, form())
      expect(post.statusCode).toBe(statusCodes.redirect)
      expect(post.headers.location).toBe(DETAIL_HREF)

      const session = [].concat(post.headers['set-cookie'] ?? []).join('; ')
      const detail = await server.inject({
        method: 'GET',
        url: DETAIL_HREF,
        headers: { cookie: session }
      })

      expect(detail.result).toEqual(
        expect.stringContaining('Could not send the query')
      )
    }
  )

  test('redirects with an error banner on a network failure', async () => {
    raiseWorkItemQuery.mockResolvedValue({
      ok: false,
      reason: 'network',
      message: 'Request timed out'
    })

    const post = await postQuery(server, form())
    expect(post.statusCode).toBe(statusCodes.redirect)

    const session = [].concat(post.headers['set-cookie'] ?? []).join('; ')
    const detail = await server.inject({
      method: 'GET',
      url: DETAIL_HREF,
      headers: { cookie: session }
    })

    expect(detail.result).toEqual(
      expect.stringContaining('There was a problem sending the query')
    )
  })

  test('falls back to a generic message when an invalid result has none', async () => {
    raiseWorkItemQuery.mockResolvedValue({ ok: false, reason: 'invalid' })

    const post = await postQuery(server, form())
    const session = [].concat(post.headers['set-cookie'] ?? []).join('; ')
    const detail = await server.inject({
      method: 'GET',
      url: DETAIL_HREF,
      headers: { cookie: session }
    })

    expect(detail.result).toEqual(
      expect.stringContaining('Could not send the query')
    )
  })

  test('rejects a POST without a CSRF crumb', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: QUERY_HREF,
      headers: urlencoded,
      payload: form()
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(raiseWorkItemQuery).not.toHaveBeenCalled()
  })
})
