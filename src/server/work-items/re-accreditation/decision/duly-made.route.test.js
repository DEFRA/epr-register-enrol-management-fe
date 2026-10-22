/**
 * RA-595 (task 004). Making a determination straight from Duly made.
 *
 * Route-level: the real server, the real re-accreditation declaration, and
 * only the backend API module mocked, so these tests observe exactly what a
 * regulator does (the page, the redirect, the banner they read) and exactly
 * what management-be is asked to do, in order.
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

const {
  getWorkItem,
  assignWorkItem,
  applyWorkItemAction,
  addWorkItemNote,
  recordReAccreditationDecision
} = await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '33333333-3333-3333-3333-333333333333'
const DETAIL_URL = `/work-items/${ID}`
const DECISION_URL = `/work-items/re-accreditation/${ID}/decision`
const COLLEAGUE_ID = 'colleague-id'

function aWorkItem(overrides = {}) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'duly-made',
    templateVersion: 'v16',
    payload: { applicationReference: 'RA-000000595' },
    availableActions: [],
    ...overrides
  }
}

let server

describe('RA-595: make a determination from Duly made', () => {
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

  describe('GET the decision page', () => {
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
          url: DECISION_URL
        })

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).toContain('Make determination for this application')
        expect(assignWorkItem).not.toHaveBeenCalled()
        expect(applyWorkItemAction).not.toHaveBeenCalled()
        expect(recordReAccreditationDecision).not.toHaveBeenCalled()
      }
    )
  })

  describe('POST a decision', () => {
    test('unassigned: assigns the caller, starts assessment, then logs the decision', async () => {
      const calls = recordBackendCalls(aWorkItem())

      const response = await submitDecision('approved')

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe(DETAIL_URL)
      expect(calls).toEqual([
        'assign',
        'action:start-assessment',
        'decision:approved'
      ])
      expect(assignWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ID,
          assigneeId: TEST_STANDARD_USER.id,
          assigneeName: TEST_STANDARD_USER.name
        })
      )
    })

    test.each([
      ['assigned to the caller', TEST_STANDARD_USER.id],
      ['held by a colleague', COLLEAGUE_ID]
    ])(
      '%s: starts assessment, then logs the decision, without assigning',
      async (_label, assignedToId) => {
        const calls = recordBackendCalls(aWorkItem({ assignedToId }))

        const response = await submitDecision('rejected')

        expect(response.headers.location).toBe(DETAIL_URL)
        expect(calls).toEqual(['action:start-assessment', 'decision:rejected'])
      }
    )

    // RA-527. Step 1 of a refusal: the detail page's persistent
    // "Application refused" banner replaces the one-time success flash.
    test('records rejected from Duly made and lands on the pending-contact banner', async () => {
      recordBackendCalls(aWorkItem())
      const pending = aWorkItem({
        stateId: 'rejected-pending-contact',
        templateVersion: 'v17'
      })
      recordReAccreditationDecision.mockImplementation(async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: pending })
        return { ok: true, workItem: pending }
      })

      const page = await followRedirect(await submitDecision('rejected'))

      expect(recordReAccreditationDecision).toHaveBeenCalledWith(
        expect.objectContaining({ workItemId: ID, outcome: 'rejected' })
      )
      expect(page).not.toContain('Decision logged: Refused')
      expect(page).toContain(
        'data-testid="re-accreditation-pending-contact-banner"'
      )
      expect(page).toContain('Application refused')
    })

    // RA-527. Step 1 of an approval: the detail page's persistent
    // "Application approved" banner replaces the one-time success flash.
    test('records approved from Duly made and lands on the pending-contact banner', async () => {
      recordBackendCalls(aWorkItem())
      const pending = aWorkItem({
        stateId: 'approved-pending-contact',
        templateVersion: 'v17',
        payload: {
          applicationReference: 'RA-000000595',
          accreditationId: 'A26ER5000270036WO'
        }
      })
      recordReAccreditationDecision.mockImplementation(async () => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: pending })
        return { ok: true, workItem: pending }
      })

      const page = await followRedirect(await submitDecision('approved'))

      expect(recordReAccreditationDecision).toHaveBeenCalledWith(
        expect.objectContaining({ workItemId: ID, outcome: 'approved' })
      )
      expect(page).not.toContain('Decision logged: Approved')
      expect(page).toContain(
        'data-testid="re-accreditation-pending-contact-banner"'
      )
    })

    test('posts the decision note after the start and before the decision', async () => {
      // The operator's decision email reads the LATEST note, so the note
      // must still go immediately before the decision.
      const calls = recordBackendCalls(aWorkItem())

      await submitDecision('approved', '&decisionNote=Looks+good')

      expect(calls).toEqual([
        'assign',
        'action:start-assessment',
        'note',
        'decision:approved'
      ])
    })

    test.each([['assessment-in-progress'], ['awaiting-decision']])(
      'from %s: logs the decision with no extra calls',
      async (stateId) => {
        const calls = recordBackendCalls(aWorkItem({ stateId }))

        await submitDecision('approved')

        expect(calls).toEqual(['decision:approved'])
      }
    )

    test('a missing choice re-renders the form and starts nothing', async () => {
      const calls = recordBackendCalls(aWorkItem())

      const response = await submitDecision('')

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(response.result).toContain(
        'Select the decision for this application'
      )
      expect(calls).toEqual([])
    })
  })

  describe('partial failures', () => {
    test('assign fails: nothing else is called and the error is shown', async () => {
      const calls = recordBackendCalls(aWorkItem())
      assignWorkItem.mockImplementation(async () => {
        calls.push('assign')
        return { ok: false, status: 409, problem: { detail: 'No' } }
      })

      const page = await followRedirect(await submitDecision('approved'))

      expect(calls).toEqual(['assign'])
      expect(page).toContain('Could not log a decision')
      expect(page).toContain(
        'This application could not be assigned to you, so the decision was not recorded. Try again.'
      )
    })

    test('start fails after assigning: says the assignment landed, and a resubmit retries only the start', async () => {
      const calls = recordBackendCalls(aWorkItem())
      applyWorkItemAction.mockImplementationOnce(async ({ actionId }) => {
        calls.push(`action:${actionId}`)
        return { ok: false, status: 500, problem: { detail: 'Boom' } }
      })

      const page = await followRedirect(await submitDecision('approved'))

      expect(calls).toEqual(['assign', 'action:start-assessment'])
      expect(page).toContain(
        'This application has been assigned to you, but it could not be started, so the decision was not recorded. Try again.'
      )

      // The case is still Duly made, now held by the caller. The decision
      // page still opens, and resubmitting repeats only the missing half.
      calls.length = 0
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ assignedToId: TEST_STANDARD_USER.id })
      })
      const reopened = await server.inject({ method: 'GET', url: DECISION_URL })
      expect(reopened.statusCode).toBe(statusCodes.ok)

      await submitDecision('approved')

      expect(calls).toEqual(['action:start-assessment', 'decision:approved'])
    })

    test('start fails on a case already held: says it could not be started', async () => {
      const calls = recordBackendCalls(
        aWorkItem({ assignedToId: COLLEAGUE_ID })
      )
      applyWorkItemAction.mockImplementationOnce(async ({ actionId }) => {
        calls.push(`action:${actionId}`)
        return { ok: false, status: 409, problem: { detail: 'No' } }
      })

      const page = await followRedirect(await submitDecision('approved'))

      expect(calls).toEqual(['action:start-assessment'])
      expect(page).toContain(
        'This application could not be started, so the decision was not recorded. Try again.'
      )
    })

    test('decision fails after the start: says it was started, and a resubmit skips the start', async () => {
      const calls = recordBackendCalls(aWorkItem())
      recordReAccreditationDecision.mockImplementationOnce(
        async ({ outcome }) => {
          calls.push(`decision:${outcome}`)
          return { ok: false, reason: 'server', status: 500, message: 'Boom' }
        }
      )

      const page = await followRedirect(await submitDecision('approved'))

      expect(calls).toEqual([
        'assign',
        'action:start-assessment',
        'decision:approved'
      ])
      expect(page).toContain(
        'This application has been assigned to you and started. There was a problem recording this decision. Try again.'
      )

      // The case is now in assessment, held by the caller.
      calls.length = 0
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'assessment-in-progress',
          assignedToId: TEST_STANDARD_USER.id
        })
      })

      await submitDecision('approved')

      expect(calls).toEqual(['decision:approved'])
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
  addWorkItemNote.mockImplementation(async () => {
    calls.push('note')
    return { ok: true, workItem }
  })
  recordReAccreditationDecision.mockImplementation(async ({ outcome }) => {
    calls.push(`decision:${outcome}`)
    return { ok: true, workItem }
  })
  return calls
}

async function submitDecision(decision, extra = '') {
  return injectWithCrumb(server, {
    method: 'POST',
    url: DECISION_URL,
    payload: `decision=${decision}${extra}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })
}
