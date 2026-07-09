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
    'operatorEmail=test%40defra.gov.uk',
    'organisationName=Acme',
    'siteAddressLine1=1%20Road',
    'siteAddressLine2=',
    'siteAddressTown=Town',
    'siteAddressPostcode=AB1%202CD',
    'material=plastic',
    'tonnageBand=500-5000'
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

  test('GET no longer renders an application reference field and seeds the default email (RA-219)', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/work-items/re-accreditation/new'
    })
    expect(statusCode).toBe(statusCodes.ok)
    // RA-219: the reference is server-generated; the form never shows it.
    expect(result).not.toMatch(/value="RA-\d{9}"/)
    expect(result).not.toEqual(
      expect.stringContaining('create-work-item-applicationReference')
    )
    expect(result).not.toEqual(
      expect.stringContaining('name="applicationReference"')
    )
    expect(result).toEqual(expect.stringContaining('value="test@defra.gov.uk"'))
    expect(result).toEqual(
      expect.stringContaining('data-testid="create-work-item-email"')
    )
  })

  test('POST with invalid email returns 400 with inline error (RA-172)', async () => {
    const payload = validForm().replace(
      'operatorEmail=test%40defra.gov.uk',
      'operatorEmail=not-an-email'
    )
    const res = await injectWithCrumb(server, {
      method: 'POST',
      url: '/work-items/re-accreditation/new',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload
    })
    expect(res.statusCode).toBe(400)
    expect(res.result).toEqual(
      expect.stringContaining(
        'Enter an email address in the correct format, like name@example.com'
      )
    )
    expect(createWorkItem).not.toHaveBeenCalled()
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
    // RA-219: no application reference is supplied by the BFF.
    expect(arg).not.toHaveProperty('applicationReference')
    expect(arg.payload).not.toHaveProperty('applicationReference')
    expect(arg.payload.operatorEmail).toBe('test@defra.gov.uk')
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

  test('Following the redirect renders the success banner with the backend-generated reference (RA-219)', async () => {
    // RA-219: the reference shown to the user is the one the backend
    // stamped onto the created work item's payload, not one the BFF made.
    createWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-99',
        payload: { applicationReference: 'RA-123456789' }
      }
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
        payload: { applicationReference: 'RA-123456789' },
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
      expect.stringContaining('Work item created — RA-123456789')
    )
  })

  test('Following the redirect renders NO success banner (never the id) when the backend omits the reference (RA-249 guard)', async () => {
    // RA-249: the success banner is LABELLED "Reference", so it must show the
    // human RA-* reference or NOTHING — never the work-item Guid. When the
    // backend omits the applicationReference we render no banner at all
    // rather than a Guid masquerading as a reference.
    createWorkItem.mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-noref' }
    })
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: 'wi-noref',
        typeId: 're-accreditation',
        stateId: 'submitted',
        submittedAt: '2026-04-27T10:00:00Z',
        lastModifiedAt: '2026-04-27T10:00:00Z',
        submittedBy: 'frontend',
        templateVersion: 'v1',
        payload: {},
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
    expect(post.headers.location).toBe('/work-items/wi-noref')

    const setCookies = [].concat(post.headers['set-cookie'] ?? [])
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ')

    const detail = await server.inject({
      method: 'GET',
      url: '/work-items/wi-noref',
      headers: { cookie: cookieHeader }
    })

    expect(detail.statusCode).toBe(200)
    // No success banner is rendered when there is no reference to show.
    expect(detail.result).not.toEqual(
      expect.stringContaining('data-testid="work-item-success-banner"')
    )
    // The work-item id must never appear as a "Reference".
    expect(detail.result).not.toEqual(
      expect.stringContaining('Work item created — wi-noref')
    )
    expect(detail.result).not.toEqual(
      expect.stringContaining('Work item created —')
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
