import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi
} from 'vitest'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', async () => {
  const actual = await vi.importActual(
    '#/server/common/helpers/backend-api/backend-api.js'
  )
  return {
    ...actual,
    createWorkItem: vi.fn(),
    getWorkItem: vi.fn(),
    getWorkItems: vi.fn()
  }
})

const { createWorkItem, getWorkItem, getWorkItems } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const validForm = () =>
  [
    'applicationReference=REF-1',
    'organisationName=Acme',
    'siteAddressLine1=1%20Road',
    'siteAddressLine2=',
    'siteAddressTown=Town',
    'siteAddressPostcode=AB1%202CD',
    'material=plastic',
    'tonnageBand=500-5000',
    'submittedByEmail=duly%40example.com'
  ].join('&')

describe('Re-accreditation create-work-item routes (RA-127, flag on)', () => {
  let server
  const flagKey = 'featureFlags.workItemCreationEnabled'
  let originalFlag

  beforeAll(async () => {
    originalFlag = config.get(flagKey)
    config.set(flagKey, true)
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set(flagKey, originalFlag)
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    createWorkItem.mockReset()
    getWorkItem.mockReset()
    getWorkItems.mockReset()
  })

  test('GET renders the form with the page heading', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/work-items/re-accreditation/new'
    })
    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Create a work item'))
    expect(result).toEqual(
      expect.stringContaining('data-testid="create-work-item-form"')
    )
  })

  test('POST with empty body returns 400 with the error summary', async () => {
    const res = await injectWithCrumb(server, {
      method: 'POST',
      url: '/work-items/re-accreditation/new',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: ''
    })
    expect(res.statusCode).toBe(400)
    expect(res.result).toEqual(
      expect.stringContaining('data-testid="create-work-item-error-summary"')
    )
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  test('POST with valid body posts to the backend and 302-redirects to the detail page', async () => {
    createWorkItem.mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-42' }
    })

    const res = await injectWithCrumb(server, {
      method: 'POST',
      url: '/work-items/re-accreditation/new',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: validForm()
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/work-items/wi-42')

    expect(createWorkItem).toHaveBeenCalledTimes(1)
    const arg = createWorkItem.mock.calls[0][0]
    expect(arg.typeId).toBe('re-accreditation')
    expect(arg.payload.applicationReference).toBe('REF-1')
    expect(arg.payload.siteAddress).toEqual({
      line1: '1 Road',
      line2: '',
      town: 'Town',
      postcode: 'AB1 2CD'
    })
    expect(arg.user).toBeDefined()
  })

  test('POST when the backend errors renders the form with a top-level error and 502', async () => {
    createWorkItem.mockResolvedValue({
      ok: false,
      reason: 'server',
      status: 503,
      message: 'Backend down'
    })

    const res = await injectWithCrumb(server, {
      method: 'POST',
      url: '/work-items/re-accreditation/new',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: validForm()
    })

    expect(res.statusCode).toBe(502)
    expect(res.result).toEqual(expect.stringContaining('Backend down'))
  })

  test('Following the redirect renders the success banner from the flash', async () => {
    createWorkItem.mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-99' }
    })
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-99',
        typeId: 're-accreditation',
        stateId: 'submitted',
        submittedAt: '2026-04-27T10:00:00Z',
        lastModifiedAt: '2026-04-27T10:00:00Z',
        submittedBy: 'frontend',
        templateVersion: 'v1',
        payload: { applicationReference: 'REF-1' },
        tasks: [],
        availableActions: []
      }
    })

    const post = await injectWithCrumb(server, {
      method: 'POST',
      url: '/work-items/re-accreditation/new',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: validForm()
    })
    expect(post.statusCode).toBe(302)
    expect(post.headers.location).toBe('/work-items/wi-99')

    // Forward all cookies from the POST response so yar's session
    // (and therefore the flash) survives into the follow-up GET.
    const setCookies = [].concat(post.headers['set-cookie'] ?? [])
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ')

    const detail = await server.inject({
      method: 'GET',
      url: '/work-items/wi-99',
      headers: { cookie: cookieHeader }
    })

    expect(detail.statusCode).toBe(200)
    expect(detail.result).toEqual(
      expect.stringContaining('data-testid="work-item-success-banner"')
    )
    expect(detail.result).toEqual(
      expect.stringContaining('Work item created — REF-1')
    )
  })
})

describe('Re-accreditation create-work-item routes (RA-127, flag off)', () => {
  let server
  const flagKey = 'featureFlags.workItemCreationEnabled'
  let originalFlag

  beforeAll(async () => {
    originalFlag = config.get(flagKey)
    config.set(flagKey, false)
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set(flagKey, originalFlag)
    await server.stop({ timeout: 0 })
  })

  test('GET returns 404 when the flag is off', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/work-items/re-accreditation/new'
    })
    expect(res.statusCode).toBe(404)
  })

  test('POST returns 404 when the flag is off', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/work-items/re-accreditation/new',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: ''
    })
    expect(res.statusCode).toBe(404)
  })
})
