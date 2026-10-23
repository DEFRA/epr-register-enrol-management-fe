/**
 * RA-527 (task 004). Once a determination has been applied (step 2, confirm
 * applicant contact) the work item is Granted or Refused, and the detail page
 * carries the Figma Design 3 wording for a closed application: the closed
 * assignment panel and the Outcome box with the final tag.
 *
 * Route-level: the real server, the real re-accreditation declaration and
 * template, only the backend API mocked.
 */
import { vi } from 'vitest'
import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
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
  confirmApplicantContact: vi.fn(),
  continueReviewReAccreditation: vi.fn(),
  dulyMakeReAccreditation: vi.fn(),
  extendWorkItemSla: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  updateRecyclingOperations: vi.fn(),
  createWorkItem: vi.fn()
}))

const { getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '52700004-0000-4000-8000-000000000527'

function aClosedItem(stateId) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId,
    templateVersion: 'v17',
    submittedAt: '2026-09-01T10:00:00Z',
    lastModifiedAt: '2026-10-20T10:00:00Z',
    assignedToId: TEST_STANDARD_USER.id,
    assignedToName: TEST_STANDARD_USER.name,
    payload: {
      applicationReference: 'RA-000000527',
      ...(stateId === 'approved'
        ? {
            accreditationId: 'A26ER5000270036WO',
            accreditationStartDate: '2026-10-20',
            accreditationYear: 2026
          }
        : {})
    },
    availableActions: []
  }
}

function squash(text) {
  return text.replace(/\s+/g, ' ').trim()
}

let server

describe('RA-527: detail page once the determination is applied', () => {
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

  test.each([
    ['approved', 'Granted'],
    ['rejected', 'Refused']
  ])(
    'a %s application shows the closed panel and the Outcome box with the %s tag',
    async (stateId, tagText) => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aClosedItem(stateId)
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect(squash($('[data-testid="assignment-closed"]').text())).toBe(
        'This application is closed and can no longer be assigned or reassigned.'
      )
      expect(
        squash($('[data-testid="re-accreditation-readonly-actions"]').text())
      ).toBe(
        'This work item is in a final state. No further decision actions are available.'
      )
      expect(
        squash($('[data-testid="re-accreditation-state-tag"]').text())
      ).toBe(tagText)
      // Nothing left to confirm.
      expect($('[data-testid="confirm-applicant-contact-cta"]').length).toBe(0)
    }
  )
})
