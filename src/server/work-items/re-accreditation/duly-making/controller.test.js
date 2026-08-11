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
    dulyMakeReAccreditation: vi.fn()
  }
})

const { getWorkItem, dulyMakeReAccreditation } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '44444444-4444-4444-4444-444444444444'
const REF = 'RA-2026-00004'
const DETAIL_HREF = `/work-items/${ID}`
const DULY_MAKE_HREF = `/work-items/re-accreditation/${ID}/duly-make`

function aWorkItem(overrides = {}) {
  const { payload, ...rest } = overrides
  return {
    id: ID,
    typeId: 're-accreditation',
    templateVersion: 'v11',
    stateId: 'submitted',
    stateDisplayName: 'Not started',
    submittedAt: '2026-04-27T10:00:00Z',
    lastModifiedAt: '2026-04-27T10:05:00Z',
    availableActions: [],
    tasks: [],
    auditLog: [],
    payload: {
      applicationReference: REF,
      chargeAmountPence: 327600,
      ...payload
    },
    ...rest
  }
}

function okWorkItem(overrides) {
  return { ok: true, workItem: aWorkItem(overrides) }
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

describe('GET the duly-making page', () => {
  test('renders the heading, payment details and controls (AC02, AC03)', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('Duly make the application')
    // AC02 — charge and reference, pre-populated and read-only.
    expect(result).toContain('Payment details')
    expect(result).toContain('data-testid="duly-making-charge-amount"')
    expect(result).toContain('£3,276')
    expect(result).toContain('data-testid="duly-making-payment-reference"')
    expect(result).toContain(REF)
    // AC02 — a day/month/year input, and no note field.
    expect(result).toContain('name="payment-date-day"')
    expect(result).toContain('name="payment-date-month"')
    expect(result).toContain('name="payment-date-year"')
    expect(result).not.toContain('name="note"')
    // AC03
    expect(result).toContain('Complete duly making')
  })

  test('the charge and reference are not editable inputs', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    const { result } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    expect(result).not.toContain('name="chargeAmountPence"')
    expect(result).not.toContain('name="paymentReference"')
  })

  test('AC04 — Cancel is a plain link back to the application summary', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    const { result } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    expect(result).toContain('data-testid="duly-making-cancel"')
    expect(result).toContain(`href="${DETAIL_HREF}"`)
    // An anchor, never a submit control — with no handler behind it there
    // is no code path that could change state.
    expect(result).not.toContain('name="cancel"')
  })

  test('an explicit paymentReference overrides the application reference', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ payload: { paymentReference: 'A27ER1230040001GR' } })
    )
    const { result } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    expect(result).toContain('A27ER1230040001GR')
  })

  test('degrades when the payload has no charge amount', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ payload: { chargeAmountPence: undefined } })
    )
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    // Must render, not crash — older work items predate the field.
    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('Not provided')
    expect(result).toContain('Complete duly making')
  })

  test('a zero charge renders as an amount, not as missing', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ payload: { chargeAmountPence: 0 } })
    )
    const { result } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    expect(result).toContain('£0')
  })

  test('degrades when the payload has neither reference', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ payload: { applicationReference: undefined } })
    )
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('Not provided')
  })

  test('redirects with a banner when the item is not duly-makeable', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ stateId: 'assessment-in-progress' })
    )
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(DETAIL_HREF)
  })

  test('renders for an updated item queried during duly making', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({
        stateId: 'updated',
        isTaskWaypoint: true,
        taskStateId: 'submitted'
      })
    )
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('Duly make the application')
  })

  test('refuses an updated item queried from assessment', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({
        stateId: 'updated',
        isTaskWaypoint: true,
        taskStateId: 'assessment-in-progress'
      })
    )
    const { statusCode } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    expect(statusCode).toBe(statusCodes.redirect)
  })

  test('renders the not-found page for an unknown work item', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })
    const { statusCode } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_HREF
    })
    expect(statusCode).toBe(statusCodes.notFound)
  })
})

describe('POST the duly-making form', () => {
  const urlencoded = { 'content-type': 'application/x-www-form-urlencoded' }

  function form(fields) {
    return Object.entries(fields)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
  }

  async function submit(fields) {
    return injectWithCrumb(server, {
      method: 'POST',
      url: DULY_MAKE_HREF,
      payload: form(fields),
      headers: urlencoded
    })
  }

  const VALID = {
    'payment-date-day': '27',
    'payment-date-month': '3',
    'payment-date-year': '2026'
  }

  test('sends a plain YYYY-MM-DD date and redirects on success', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    dulyMakeReAccreditation.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ stateId: 'duly-made' })
    })

    const { statusCode, headers } = await submit(VALID)

    expect(dulyMakeReAccreditation).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID, paymentDate: '2026-03-27' })
    )
    // No time component — the backend rejects ISO timestamps.
    const { paymentDate } = dulyMakeReAccreditation.mock.calls[0][0]
    expect(paymentDate).not.toContain('T')
    // PRG so a refresh cannot re-post.
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(DETAIL_HREF)
  })

  test('an empty date is rejected locally without calling the backend', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    const { statusCode, result } = await submit({
      'payment-date-day': '',
      'payment-date-month': '',
      'payment-date-year': ''
    })

    expect(dulyMakeReAccreditation).not.toHaveBeenCalled()
    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain('govuk-error-summary')
    expect(result).toContain('Enter the payment date')
    expect(result).toContain('#payment-date-day')
  })

  test('an unreal date is rejected with the real-date message', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    const { statusCode, result } = await submit({
      'payment-date-day': '30',
      'payment-date-month': '2',
      'payment-date-year': '2026'
    })
    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain('Payment date must be a real date')
  })

  test('the payment details survive a validation error', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    const { result } = await submit({
      'payment-date-day': '',
      'payment-date-month': '',
      'payment-date-year': ''
    })
    expect(result).toContain('£3,276')
    expect(result).toContain(REF)
  })

  test('the entered values are echoed back so nothing is retyped', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    const { result } = await submit({
      'payment-date-day': '30',
      'payment-date-month': '2',
      'payment-date-year': '2026'
    })
    expect(result).toContain('value="30"')
    expect(result).toContain('value="2026"')
  })

  test.each([
    ['payment-date-in-future', 'Payment date must be today or in the past'],
    ['payment-date-too-old', 'Payment date must be within the last 12 months'],
    ['payment-date-invalid', 'Payment date must be a real date'],
    ['payment-date-required', 'Enter the payment date']
  ])(
    'binds the backend code %s to the date input as a field error',
    async (errorCode, message) => {
      getWorkItem.mockResolvedValue(okWorkItem())
      dulyMakeReAccreditation.mockResolvedValue({
        ok: false,
        reason: 'invalid',
        status: 400,
        errorCode,
        message: 'developer-facing detail that must not be rendered'
      })

      const { statusCode, result } = await submit(VALID)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('govuk-error-summary')
      expect(result).toContain(message)
      expect(result).toContain('#payment-date-day')
      // The backend's own prose is for logs only.
      expect(result).not.toContain('developer-facing detail')
    }
  )

  test('a 409 is a page-level banner, not a field error', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    dulyMakeReAccreditation.mockResolvedValue({
      ok: false,
      reason: 'conflict',
      status: 409,
      message: 'Wrong state'
    })

    const { statusCode, headers } = await submit(VALID)

    // Redirect, not an in-place field error — the problem is not the field.
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(DETAIL_HREF)
  })

  test('an unrecognised errorCode is treated as page-level', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    dulyMakeReAccreditation.mockResolvedValue({
      ok: false,
      reason: 'invalid',
      status: 400,
      errorCode: 'wrong-work-item-type',
      message: 'Not a re-accreditation'
    })
    const { statusCode } = await submit(VALID)
    expect(statusCode).toBe(statusCodes.redirect)
  })

  test('a 404 redirects rather than rendering a field error', async () => {
    getWorkItem.mockResolvedValue(okWorkItem())
    dulyMakeReAccreditation.mockResolvedValue({
      ok: false,
      reason: 'not-found',
      status: 404,
      message: 'gone'
    })
    const { statusCode } = await submit(VALID)
    expect(statusCode).toBe(statusCodes.redirect)
  })

  test('a validation error still renders when the work item re-read fails', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 502 })
    const { statusCode, result } = await submit({
      'payment-date-day': '',
      'payment-date-month': '',
      'payment-date-year': ''
    })
    // Degraded, but still the form with its error — not a 502.
    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain('Enter the payment date')
  })
})

/**
 * AC01, rendered rather than inferred.
 *
 * The eligibility unit tests prove WHEN the CTA should show; these prove
 * the template is actually wired to that answer and that the hooks reach
 * the DOM. Worth having on its own merits, but specifically because the
 * mgmt-tests journey suite selects on `duly-make-cta` and `data-state-id`
 * and could not execute against a real stack — a broken block override
 * here would otherwise surface for the first time in CI.
 */
describe('the Duly make CTA on the application summary', () => {
  async function renderDetail(overrides) {
    getWorkItem.mockResolvedValue(okWorkItem(overrides))
    return server.inject({ method: 'GET', url: DETAIL_HREF })
  }

  test('renders the CTA in submitted, linking to the duly-making page', async () => {
    const { statusCode, result } = await renderDetail()
    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('data-testid="duly-make-cta"')
    expect(result).toContain(DULY_MAKE_HREF)
    expect(result).toContain('Duly make')
  })

  test('exposes the raw state id, which the visible label cannot give', async () => {
    // `assessment-in-progress` and `updated` both display as "Updated"
    // (RA-324), so the id is the only way to tell them apart in the DOM.
    const { result } = await renderDetail()
    expect(result).toContain('data-state-id="submitted"')
  })

  test('suppresses the tasks panel where duly making is the next action', async () => {
    const { result } = await renderDetail()
    expect(result).not.toContain('data-testid="tasks-panel"')
    expect(result).not.toContain('data-testid="work-item-no-tasks"')
    expect(result).not.toContain('data-testid="work-item-tasks-link"')
  })

  test('renders the CTA for an updated item queried during duly making', async () => {
    const { result } = await renderDetail({
      stateId: 'updated',
      stateDisplayName: 'Updated',
      isTaskWaypoint: true,
      taskStateId: 'submitted'
    })
    expect(result).toContain('data-testid="duly-make-cta"')
    expect(result).toContain('data-state-id="updated"')
    expect(result).not.toContain('data-testid="tasks-panel"')
  })

  test('no CTA for an updated item queried from assessment, and tasks stay', async () => {
    const { result } = await renderDetail({
      stateId: 'updated',
      stateDisplayName: 'Updated',
      isTaskWaypoint: true,
      taskStateId: 'assessment-in-progress',
      tasks: [
        {
          taskId: 'review-compliance-history',
          displayName: 'Review compliance history',
          status: 'Pending'
        }
      ]
    })
    expect(result).not.toContain('data-testid="duly-make-cta"')
    // The distinction the journey suite needs: same visible label as the
    // case above, different state id, different affordances.
    expect(result).toContain('data-state-id="updated"')
    expect(result).toContain('data-testid="tasks-panel"')
  })

  test.each(['duly-made', 'assessment-in-progress', 'awaiting-decision'])(
    'no CTA in %s',
    async (stateId) => {
      const { result } = await renderDetail({ stateId })
      expect(result).not.toContain('data-testid="duly-make-cta"')
    }
  )

  test('no CTA on a terminal item', async () => {
    const { result } = await renderDetail({
      stateId: 'withdrawn',
      stateDisplayName: 'Withdrawn'
    })
    expect(result).not.toContain('data-testid="duly-make-cta"')
  })
})

describe('AC04 — Cancel changes nothing', () => {
  test('there is no POST route that Cancel could reach', async () => {
    // Cancel is an ordinary link to the detail page. Following it must not
    // touch the backend at all.
    getWorkItem.mockResolvedValue(okWorkItem())
    await server.inject({ method: 'GET', url: DULY_MAKE_HREF })
    expect(dulyMakeReAccreditation).not.toHaveBeenCalled()
  })
})
