import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  addWorkItemTaskNote: vi.fn(),
  extendWorkItemSla: vi.fn(),
  overrideWorkItemSla: vi.fn()
}))

const { extendWorkItemSla, overrideWorkItemSla } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '22222222-2222-2222-2222-222222222222'

describe('#makeShowExtendController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('GET renders the extend SLA form', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/extend`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Extend SLA'))
    expect(result).toEqual(expect.stringContaining('sla-extend-form'))
    expect(result).toEqual(expect.stringContaining(ID))
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
  })

  test('POST with valid data redirects to detail page on success', async () => {
    extendWorkItemSla.mockResolvedValue({
      ok: true,
      workItem: { id: ID }
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Need+more+time&additionalDays=7`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(extendWorkItemSla).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        reason: 'Need more time',
        additionalDuration: 'P7D'
      })
    )
  })

  test('POST with empty reason re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=&additionalDays=7`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(result).toEqual(expect.stringContaining('Reason is required'))
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })

  test('POST with invalid days re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Some+reason&additionalDays=notanumber`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })

  test('POST redirects with error flash on forbidden response', async () => {
    extendWorkItemSla.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      status: 403,
      message: 'Forbidden'
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Some+reason&additionalDays=3`,
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
      reason: 'conflict',
      status: 409,
      message: 'Conflict'
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Some+reason&additionalDays=3`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
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

  test('GET renders the override SLA form', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/override`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Override SLA'))
    expect(result).toEqual(expect.stringContaining('sla-override-form'))
    expect(result).toEqual(expect.stringContaining(ID))
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
