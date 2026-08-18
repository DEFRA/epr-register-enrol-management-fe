import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  extendWorkItemSla: vi.fn(),
  overrideWorkItemSla: vi.fn()
}))

const { extendWorkItemSla, overrideWorkItemSla, getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '22222222-2222-2222-2222-222222222222'
const REF = 'RA-123456789'

// Fixed "current due date" used by the extend fixtures below, so a new
// deadline of 2026-07-01 is unambiguously an extension.
const CURRENT_DUE_DATE = '2026-06-01T00:00:00Z'

const aWorkItem = {
  id: ID,
  payload: { applicationReference: REF },
  slaDueDate: CURRENT_DUE_DATE
}

const VALID_DEADLINE_PAYLOAD =
  'new-deadline-day=1&new-deadline-month=7&new-deadline-year=2026'

describe('#makeShowExtendController', () => {
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
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem })
  })

  test('GET renders the extend determination deadline form', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/extend`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('Extend determination deadline')
    )
    expect(result).toEqual(expect.stringContaining('sla-extend-form'))
    expect(result).toEqual(expect.stringContaining('sla-extend-days'))
    expect(result).toEqual(expect.stringContaining(REF))
  })

  // RA-358 AC2. This route is one of the nine callers of the shared
  // not-found view, but had no 404 coverage at all, so its copy could
  // drift back without anything failing.
  test('GET renders the 404 page in application terms', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/extend`
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Application not found'))
    // The breadcrumb must speak the same vocabulary as the heading and the
    // back link, all three of which point at /work-items. Scoped to the
    // breadcrumb class: the header nav also renders a "Work items" link, so
    // a bare substring check would be ambiguous.
    expect(result).toContain(
      '<a class="govuk-breadcrumbs__link" href="/work-items">Applications</a>'
    )
    expect(result).not.toEqual(expect.stringContaining('No work item exists'))
  })
})

describe('#makeSubmitExtendController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    extendWorkItemSla.mockReset()
    getWorkItem.mockReset()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem })
  })

  test('POST with a valid new deadline applies the extension and redirects to detail', async () => {
    extendWorkItemSla.mockResolvedValue({ ok: true, workItem: { id: ID } })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Need+more+time&${VALID_DEADLINE_PAYLOAD}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    // 2026-06-01 → 2026-07-01 is 30 days.
    expect(extendWorkItemSla).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        reason: 'Need more time',
        additionalDuration: 'P30D'
      })
    )
  })

  test('POST with empty reason re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=&${VALID_DEADLINE_PAYLOAD}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(result).toEqual(expect.stringContaining('Reason is required'))
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })

  test('POST with an invalid date re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload:
        'reason=Some+reason&new-deadline-day=31&new-deadline-month=2&new-deadline-year=2026',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(result).toEqual(
      expect.stringContaining('Determination deadline must be a real date')
    )
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })

  // RA-447 CM6: the extension cap is gone, but a reduction is still
  // rejected — a new deadline on/before the current one is not an extension.
  test('POST with a new deadline that is not after the current one re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload:
        'reason=Some+reason&new-deadline-day=1&new-deadline-month=6&new-deadline-year=2026',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(
      expect.stringContaining(
        'The new determination deadline must be after the current deadline'
      )
    )
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })

  test('POST redirects with error flash on forbidden response', async () => {
    extendWorkItemSla.mockResolvedValue({
      ok: false,
      outcome: 'forbidden',
      status: 403,
      message: 'Forbidden'
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Some+reason&${VALID_DEADLINE_PAYLOAD}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
  })

  test('POST redirects with error flash on conflict response', async () => {
    extendWorkItemSla.mockResolvedValue({
      ok: false,
      outcome: 'conflict',
      status: 409,
      message: 'Conflict'
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Some+reason&${VALID_DEADLINE_PAYLOAD}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
  })

  // RA-358 AC2 equivalent for the submit path: the work item is now fetched
  // on every submit (RA-447 CM6 needs its slaDueDate before validating), so
  // this path needs the same 404 coverage as the GET handler.
  test('POST renders the 404 page when the work item does not exist', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Some+reason&${VALID_DEADLINE_PAYLOAD}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Application not found'))
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })
})

describe('#makeShowOverrideController', () => {
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
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem })
  })

  test('GET renders the override determination deadline form', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/override`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('Override determination deadline')
    )
    expect(result).toEqual(expect.stringContaining('sla-override-form'))
    expect(result).toEqual(expect.stringContaining(REF))
  })

  // RA-358 AC2. As above — the second of this controller's two callers of
  // the shared not-found view, previously uncovered.
  test('GET renders the 404 page in application terms', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/override`
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Application not found'))
    expect(result).toContain(
      '<a class="govuk-breadcrumbs__link" href="/work-items">Applications</a>'
    )
    expect(result).not.toEqual(expect.stringContaining('No work item exists'))
  })
})

describe('#makeSubmitOverrideController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    overrideWorkItemSla.mockReset()
    getWorkItem.mockReset()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem })
  })

  test('POST with valid data redirects to detail page on success', async () => {
    overrideWorkItemSla.mockResolvedValue({
      ok: true,
      workItem: { id: ID }
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/override`,
      payload: `reason=Reset+clock&newTargetDays=30&newStartedAt=2024-01-15T09%3A00%3A00Z`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(overrideWorkItemSla).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        reason: 'Reset clock',
        newTargetDuration: 'P30D'
      })
    )
  })

  test('POST with empty reason re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/override`,
      payload: `reason=&newTargetDays=30&newStartedAt=2024-01-15T09%3A00%3A00Z`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(result).toEqual(expect.stringContaining('Reason is required'))
    expect(overrideWorkItemSla).not.toHaveBeenCalled()
  })

  test('POST with invalid days re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/override`,
      payload: `reason=Some+reason&newTargetDays=abc&newStartedAt=2024-01-15T09%3A00%3A00Z`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(overrideWorkItemSla).not.toHaveBeenCalled()
  })

  test('POST with invalid date re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/override`,
      payload: `reason=Some+reason&newTargetDays=30&newStartedAt=not-a-date`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(overrideWorkItemSla).not.toHaveBeenCalled()
  })

  test('POST redirects with error flash on forbidden response', async () => {
    overrideWorkItemSla.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      status: 403,
      message: 'Forbidden'
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/override`,
      payload: `reason=Some+reason&newTargetDays=30&newStartedAt=2024-01-15T09%3A00%3A00Z`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
  })

  test('POST redirects with error flash on conflict response', async () => {
    overrideWorkItemSla.mockResolvedValue({
      ok: false,
      reason: 'conflict',
      status: 409,
      message: 'Conflict'
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/override`,
      payload: `reason=Some+reason&newTargetDays=30&newStartedAt=2024-01-15T09%3A00%3A00Z`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
  })
})
