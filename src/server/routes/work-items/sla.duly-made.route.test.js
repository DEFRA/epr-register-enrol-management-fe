/**
 * RA-595 (task 005). Changing the determination deadline straight from Duly
 * made.
 *
 * Route-level, following `sla.controller.test.js` and task 004's
 * `decision/duly-made.route.test.js`: the real server, the real
 * re-accreditation declaration, and only the backend API module mocked, so
 * these tests observe what a regulator sees and exactly what management-be is
 * asked to do, in order.
 */
import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'
import { TEST_STANDARD_USER } from '#/server/common/helpers/auth/stub-auth-plugin.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  recordReAccreditationDecision: vi.fn(),
  continueReviewReAccreditation: vi.fn(),
  dulyMakeReAccreditation: vi.fn(),
  extendWorkItemSla: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  updateRecyclingOperations: vi.fn(),
  createWorkItem: vi.fn()
}))

const { getWorkItem, assignWorkItem, applyWorkItemAction, extendWorkItemSla } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '55555555-5555-5555-5555-555555555555'
const DETAIL_URL = `/work-items/${ID}`
const EXTEND_URL = `/work-items/${ID}/sla/extend`
const COLLEAGUE_ID = 'colleague-id'

// Duly made on 3 March 2026 (the payment date the SLA clock is anchored to),
// due 12 weeks later. The clock is pinned so the RA-611 floor holds still.
const NOW = new Date('2026-04-10T09:00:00Z')
const SLA_STARTED_AT = '2026-03-03T00:00:00Z'
const SLA_DUE_DATE = '2026-05-26T00:00:00Z'

// 26 May -> 30 June 2026: a 35-day push back.
const VALID_CHANGE =
  'reason=Waiting+on+evidence&new-deadline-day=30&new-deadline-month=6&new-deadline-year=2026'

function aWorkItem(overrides = {}) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'duly-made',
    templateVersion: 'v16',
    payload: { applicationReference: 'RA-000000595' },
    availableActions: [],
    slaStartedAt: SLA_STARTED_AT,
    slaDueDate: SLA_DUE_DATE,
    ...overrides
  }
}

let server

describe('RA-595: change the determination deadline from Duly made', () => {
  beforeAll(async () => {
    // Only `Date` is faked, so the server's own timers keep running.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST a deadline change', () => {
    test('unassigned: assigns the caller, starts assessment, then changes the deadline', async () => {
      const calls = recordBackendCalls(aWorkItem())

      const response = await submitChange()

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe(DETAIL_URL)
      expect(calls).toEqual(['assign', 'action:start-assessment', 'sla-extend'])
      expect(assignWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ID,
          assigneeId: TEST_STANDARD_USER.id,
          assigneeName: TEST_STANDARD_USER.name
        })
      )
      expect(extendWorkItemSla).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ID,
          reason: 'Waiting on evidence',
          additionalDuration: 'P35D'
        })
      )
    })

    test.each([
      ['assigned to the caller', TEST_STANDARD_USER.id],
      ['held by a colleague', COLLEAGUE_ID]
    ])(
      '%s: starts assessment, then changes the deadline, without assigning',
      async (_label, assignedToId) => {
        const calls = recordBackendCalls(aWorkItem({ assignedToId }))

        const page = await followRedirect(await submitChange())

        expect(calls).toEqual(['action:start-assessment', 'sla-extend'])
        expect(page).toContain('Determination deadline changed')
      }
    )

    // RA-527 follow-up. A started case (`assessment-started`) is already
    // started: the submit goes straight to the deadline change, which
    // management-be applies as a move to `assessment-in-progress` ("Updated").
    test.each([
      ['assessment-started'],
      ['assessment-in-progress'],
      ['queried']
    ])('from %s: changes the deadline with no extra calls', async (stateId) => {
      const calls = recordBackendCalls(
        aWorkItem({ stateId, assignedToId: TEST_STANDARD_USER.id })
      )

      const page = await followRedirect(await submitChange())

      expect(calls).toEqual(['sla-extend'])
      expect(page).toContain('Determination deadline changed')
    })

    test('a missing reason re-renders the form and starts nothing', async () => {
      const calls = recordBackendCalls(aWorkItem())

      const response = await submitChange(
        'reason=&new-deadline-day=30&new-deadline-month=6&new-deadline-year=2026'
      )

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(response.result).toContain('Reason is required')
      expect(calls).toEqual([])
    })

    test('a deadline before the duly-made date is rejected and starts nothing', async () => {
      // The floor is still the payment date the SLA clock is anchored to.
      const calls = recordBackendCalls(aWorkItem())

      const response = await submitChange(
        'reason=Backdate&new-deadline-day=2&new-deadline-month=3&new-deadline-year=2026'
      )

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(response.result).toContain(
        'The new determination deadline cannot be earlier than 3 March 2026, when the application was duly made'
      )
      expect(calls).toEqual([])
    })

    test('a backdate to the duly-made date itself is accepted, measured from the existing deadline', async () => {
      const calls = recordBackendCalls(aWorkItem())

      await submitChange(
        'reason=Backdate&new-deadline-day=3&new-deadline-month=3&new-deadline-year=2026'
      )

      expect(calls).toEqual(['assign', 'action:start-assessment', 'sla-extend'])
      // 26 May back to 3 March: 84 days. The clock's anchor is not moved.
      expect(extendWorkItemSla).toHaveBeenCalledWith(
        expect.objectContaining({ additionalDuration: '-P84D' })
      )
    })
  })

  describe('GET the deadline page', () => {
    test.each([
      ['unassigned', {}],
      ['assigned to the caller', { assignedToId: TEST_STANDARD_USER.id }],
      ['held by a colleague', { assignedToId: COLLEAGUE_ID }]
    ])(
      'opens on a Duly made case %s and changes nothing',
      async (_label, overrides) => {
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: aWorkItem(overrides)
        })

        const { statusCode, result } = await server.inject({
          method: 'GET',
          url: EXTEND_URL
        })

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).toContain('Change determination deadline')
        expect(assignWorkItem).not.toHaveBeenCalled()
        expect(applyWorkItemAction).not.toHaveBeenCalled()
        expect(extendWorkItemSla).not.toHaveBeenCalled()
      }
    )
  })

  describe('partial failures', () => {
    test('assign fails: nothing else is called and the error is shown', async () => {
      const calls = recordBackendCalls(aWorkItem())
      assignWorkItem.mockImplementation(async () => {
        calls.push('assign')
        return { ok: false, status: 409, problem: { detail: 'No' } }
      })

      const page = await followRedirect(await submitChange())

      expect(calls).toEqual(['assign'])
      expect(page).toContain('Could not change the determination deadline')
      expect(page).toContain(
        'This application could not be assigned to you, so the determination deadline was not changed. Try again.'
      )
    })

    test('start fails after assigning: says the assignment landed, and a resubmit retries only the start', async () => {
      const calls = recordBackendCalls(aWorkItem())
      applyWorkItemAction.mockImplementationOnce(async ({ actionId }) => {
        calls.push(`action:${actionId}`)
        return { ok: false, status: 500, problem: { detail: 'Boom' } }
      })

      const page = await followRedirect(await submitChange())

      expect(calls).toEqual(['assign', 'action:start-assessment'])
      expect(page).toContain(
        'This application has been assigned to you, but it could not be started, so the determination deadline was not changed. Try again.'
      )

      // Still Duly made, now held by the caller. The page still opens, and
      // resubmitting repeats only the missing half.
      calls.length = 0
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ assignedToId: TEST_STANDARD_USER.id })
      })
      const reopened = await server.inject({ method: 'GET', url: EXTEND_URL })
      expect(reopened.statusCode).toBe(statusCodes.ok)

      await submitChange()

      expect(calls).toEqual(['action:start-assessment', 'sla-extend'])
    })

    test('start fails on a case already held: says it could not be started', async () => {
      const calls = recordBackendCalls(
        aWorkItem({ assignedToId: COLLEAGUE_ID })
      )
      applyWorkItemAction.mockImplementationOnce(async ({ actionId }) => {
        calls.push(`action:${actionId}`)
        return { ok: false, status: 409, problem: { detail: 'No' } }
      })

      const page = await followRedirect(await submitChange())

      expect(calls).toEqual(['action:start-assessment'])
      expect(page).toContain(
        'This application could not be started, so the determination deadline was not changed. Try again.'
      )
    })

    test('change fails after the start: says it was started, and a resubmit skips the start', async () => {
      const calls = recordBackendCalls(aWorkItem())
      extendWorkItemSla.mockImplementationOnce(async () => {
        calls.push('sla-extend')
        return { ok: false, reason: 'conflict', message: 'Conflict' }
      })

      const page = await followRedirect(await submitChange())

      expect(calls).toEqual(['assign', 'action:start-assessment', 'sla-extend'])
      expect(page).toContain('Could not change the determination deadline')
      expect(page).toContain(
        'This application has been assigned to you and started. The work item state changed. Refresh and try again.'
      )

      // Now in assessment, held by the caller.
      calls.length = 0
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'assessment-in-progress',
          assignedToId: TEST_STANDARD_USER.id
        })
      })

      const retried = await followRedirect(await submitChange())

      expect(calls).toEqual(['sla-extend'])
      expect(retried).toContain('Determination deadline changed')
    })
  })
})

/**
 * Follow a PRG redirect back to the detail page IN THE SAME SESSION and
 * return what it rendered. Banners are flashed into the yar session, so the
 * POST response alone proves only that a redirect happened.
 */
async function followRedirect(posted) {
  expect(posted.statusCode).toBe(statusCodes.redirect)
  expect(posted.headers.location).toBe(DETAIL_URL)
  const cookie = []
    .concat(posted.headers['set-cookie'] ?? [])
    .map((header) => header.split(';')[0])
    .join('; ')
  const followed = await server.inject({
    method: 'GET',
    url: DETAIL_URL,
    headers: { cookie }
  })
  return followed.result
}

/**
 * Point every write mock at a shared, ordered log and make each succeed, so
 * a test can assert the exact sequence of backend calls. `getWorkItem`
 * answers with `workItem` throughout.
 */
function recordBackendCalls(workItem) {
  const calls = []
  getWorkItem.mockResolvedValue({ ok: true, workItem })
  assignWorkItem.mockImplementation(async () => {
    calls.push('assign')
    return { ok: true, workItem }
  })
  applyWorkItemAction.mockImplementation(async ({ actionId }) => {
    calls.push(`action:${actionId}`)
    return { ok: true, workItem }
  })
  extendWorkItemSla.mockImplementation(async () => {
    calls.push('sla-extend')
    return { ok: true, workItem }
  })
  return calls
}

async function submitChange(payload = VALID_CHANGE) {
  return injectWithCrumb(server, {
    method: 'POST',
    url: EXTEND_URL,
    payload,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })
}
