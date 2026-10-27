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
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', async () => {
  const actual = await vi.importActual(
    '#/server/common/helpers/backend-api/backend-api.js'
  )
  return {
    ...actual,
    getWorkItem: vi.fn(),
    getWorkItems: vi.fn(),
    changePaymentDateReAccreditation: vi.fn()
  }
})

const { getWorkItem, changePaymentDateReAccreditation } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '55555555-5555-5555-5555-555555555555'
const REF = 'RA-2026-00005'
const DETAIL_HREF = `/work-items/${ID}`
const CHANGE_HREF = `/work-items/re-accreditation/${ID}/change-payment-date`

function aWorkItem(overrides = {}) {
  const { payload, ...rest } = overrides
  const stateId = rest.stateId ?? 'duly-made'
  return {
    id: ID,
    typeId: 're-accreditation',
    templateVersion: 'v17',
    stateId,
    originStateId: stateId,
    applicationReference: REF,
    availableActions: [],
    auditLog: [],
    payload: {
      applicationReference: REF,
      paymentDate: '2026-07-15',
      ...payload
    },
    ...rest
  }
}

const okWorkItem = (overrides) => ({
  ok: true,
  workItem: aWorkItem(overrides)
})

function daysAgo(days) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return {
    day: String(d.getUTCDate()),
    month: String(d.getUTCMonth() + 1),
    year: String(d.getUTCFullYear()),
    iso: d.toISOString().slice(0, 10)
  }
}

let server

beforeAll(async () => {
  server = await createServer()
  await server.initialize()
})

afterAll(async () => {
  await server.stop({ timeout: 0 })
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET the change-payment-date page (RA-576)', () => {
  test('shows the current payment date as dd/mm/yyyy with the date and reason inputs', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: CHANGE_HREF
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('Change payment date')
    expect(result).toContain('The current payment date is 15/07/2026')
    expect(result).toContain('name="payment-date-day"')
    expect(result).toContain('name="payment-date-month"')
    expect(result).toContain('name="payment-date-year"')
    expect(result).toContain('Reason for payment change')
    expect(result).toContain('name="reason"')
    expect(result).toContain('data-testid="change-payment-date-submit"')
  })

  test('Cancel is a plain link back to the detail page', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    const { result } = await server.inject({ method: 'GET', url: CHANGE_HREF })
    expect(result).toContain('data-testid="change-payment-date-cancel"')
    expect(result).toContain(`href="${DETAIL_HREF}"`)
  })

  test.each(['approved', 'rejected', 'withdrawn'])(
    'redirects a terminal %s item to the detail page',
    async (stateId) => {
      getWorkItem.mockResolvedValue(okWorkItem({ stateId }))
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: CHANGE_HREF
      })
      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(DETAIL_HREF)
    }
  )

  test('redirects an item with no payment date to the detail page', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ payload: { paymentDate: undefined } })
    )
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: CHANGE_HREF
    })
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(DETAIL_HREF)
  })

  test('renders the not-found page for an unknown work item', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })
    const { statusCode } = await server.inject({
      method: 'GET',
      url: CHANGE_HREF
    })
    expect(statusCode).toBe(statusCodes.notFound)
  })
})

describe('POST the change-payment-date form (RA-576)', () => {
  const urlencoded = { 'content-type': 'application/x-www-form-urlencoded' }

  function form(fields) {
    return Object.entries(fields)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
  }

  function submit(fields) {
    return injectWithCrumb(server, {
      method: 'POST',
      url: CHANGE_HREF,
      payload: form(fields),
      headers: urlencoded
    })
  }

  const date = daysAgo(3)
  const VALID = {
    'payment-date-day': date.day,
    'payment-date-month': date.month,
    'payment-date-year': date.year,
    reason: 'Operator keyed the wrong date.'
  }

  test('sends a plain YYYY-MM-DD date and the reason, then redirects to the detail page', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    changePaymentDateReAccreditation.mockResolvedValue({
      ok: true,
      workItem: aWorkItem()
    })

    const { statusCode, headers } = await submit(VALID)

    expect(changePaymentDateReAccreditation).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        paymentDate: date.iso,
        reason: 'Operator keyed the wrong date.'
      })
    )
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(DETAIL_HREF)
  })

  test('a missing reason is blocked locally with a field error (AC03)', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())

    const { statusCode, result } = await submit({ ...VALID, reason: '  ' })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(changePaymentDateReAccreditation).not.toHaveBeenCalled()
    expect(result).toContain('Enter a reason for the payment date change')
    expect(result).toContain('href="#reason"')
    // The current date survives the round trip.
    expect(result).toContain('The current payment date is 15/07/2026')
  })

  test('a reason over 200 words is blocked locally', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    const reason = Array.from({ length: 201 }, () => 'word').join(' ')

    const { statusCode, result } = await submit({ ...VALID, reason })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(changePaymentDateReAccreditation).not.toHaveBeenCalled()
    expect(result).toContain('Reason must be 200 words or fewer')
  })

  test('a bad date and a missing reason are both reported at once', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())

    const { statusCode, result } = await submit({
      'payment-date-day': '',
      'payment-date-month': '',
      'payment-date-year': '',
      reason: ''
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain('Enter the payment date')
    expect(result).toContain('Enter a reason for the payment date change')
    expect(changePaymentDateReAccreditation).not.toHaveBeenCalled()
  })

  test('keeps what the user typed when re-rendering', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())

    const { result } = await submit({
      ...VALID,
      reason: '',
      'payment-date-year': '1999'
    })

    expect(result).toContain('value="1999"')
    expect(result).toContain('Payment date must be within the last 12 months')
  })

  test.each([
    ['payment-date-in-future', 'Payment date must be today or in the past'],
    [
      'payment-date-reason-required',
      'Enter a reason for the payment date change'
    ],
    ['payment-date-reason-too-long', 'Reason must be 200 words or fewer']
  ])('binds a backend %s rejection to its field', async (errorCode, copy) => {
    getWorkItem.mockResolvedValue(okWorkItem())
    changePaymentDateReAccreditation.mockResolvedValue({
      ok: false,
      reason: 'invalid',
      status: 400,
      errorCode,
      message: 'developer-facing detail that must not be rendered'
    })

    const { statusCode, result } = await submit(VALID)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain(copy)
    expect(result).not.toContain('developer-facing detail')
  })

  test('a 409 redirects to the detail page rather than blaming a field', async () => {
    changePaymentDateReAccreditation.mockResolvedValue({
      ok: false,
      reason: 'conflict',
      status: 409,
      message: 'terminal'
    })

    const { statusCode, headers } = await submit(VALID)

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(DETAIL_HREF)
  })

  test('an unexpected failure redirects to the detail page', async () => {
    changePaymentDateReAccreditation.mockResolvedValue({
      ok: false,
      reason: 'server',
      status: 500,
      message: 'boom'
    })

    const { statusCode, headers } = await submit(VALID)

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(DETAIL_HREF)
  })
})
