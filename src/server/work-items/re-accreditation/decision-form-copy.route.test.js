/**
 * RA-527 (task 002). The "Make determination" form carries the Figma Design 3
 * copy: a short H1, "Notes (optional)", and a hint that folds the "contact the
 * applicant" instruction into the audit-log sentence instead of leaving it as
 * a loose instruction of its own.
 *
 * Route-level: the real server and template, only the backend API mocked, so
 * this asserts what a regulator actually reads.
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
  continueReviewReAccreditation: vi.fn(),
  dulyMakeReAccreditation: vi.fn(),
  extendWorkItemSla: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  updateRecyclingOperations: vi.fn(),
  createWorkItem: vi.fn()
}))

const { getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '52752752-7527-5275-2752-752752752752'
const DECISION_URL = `/work-items/re-accreditation/${ID}/decision`
const REF = 'RA-000000527'

const NOTE_HINT =
  'The determination will be recorded in the application history (audit log). You need to contact the applicant when the determination has been made.'

let server

async function renderDecisionPage() {
  getWorkItem.mockResolvedValue({
    ok: true,
    workItem: {
      id: ID,
      typeId: 're-accreditation',
      stateId: 'assessment-in-progress',
      templateVersion: 'v16',
      assignedToId: TEST_STANDARD_USER.id,
      payload: { applicationReference: REF },
      availableActions: []
    }
  })

  const { statusCode, result } = await server.inject({
    method: 'GET',
    url: DECISION_URL
  })
  expect(statusCode).toBe(statusCodes.ok)
  return { html: result, $: cheerio.load(result) }
}

function squash(text) {
  return text.replace(/\s+/g, ' ').trim()
}

describe('RA-527: Make determination form copy', () => {
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

  test('the H1 is "Make determination"', async () => {
    const { $ } = await renderDecisionPage()

    expect($('h1').length).toBe(1)
    expect(squash($('h1').text())).toBe('Make determination')
    expect(squash($('[data-testid="app-heading-caption"]').text())).toBe(
      `Work item ${REF}`
    )
  })

  test('the notes field is labelled "Notes (optional)" with the Design 3 hint', async () => {
    const { $ } = await renderDecisionPage()

    expect(squash($('label[for="field-decisionNote"]').text())).toBe(
      'Notes (optional)'
    )
    expect(squash($('#field-decisionNote-hint').text())).toBe(NOTE_HINT)
  })

  test('the contact instruction no longer stands on its own', async () => {
    const { html } = await renderDecisionPage()

    // The sentence survives only inside the new hint ("You need to contact
    // ..."); the old standalone imperative must be gone.
    expect(html).not.toContain(
      'Contact the applicant when the determination has been made.'
    )
    expect(html).not.toContain('Determination note (optional)')
  })

  test('the page title and breadcrumb are unchanged', async () => {
    const { $ } = await renderDecisionPage()

    expect(squash($('title').text())).toMatch(
      /^Make determination for this application \|/
    )
    expect(
      $('.govuk-breadcrumbs__list-item')
        .map((_, el) => squash($(el).text()))
        .get()
    ).toEqual(['Work items', REF, 'Make determination'])
  })

  test('the warning, radios, button and Cancel are unchanged', async () => {
    const { $ } = await renderDecisionPage()

    expect(squash($('.govuk-warning-text__text').text())).toBe(
      'Warning This determination is final and it cannot be changed.'
    )
    expect(squash($('label[for="decision-approved"]').text())).toBe('Approved')
    expect(squash($('label[for="decision-refused"]').text())).toBe('Refused')
    expect(squash($('[data-testid="log-decision-submit"]').text())).toBe(
      'Make determination'
    )
    expect(squash($('[data-testid="log-decision-cancel"]').text())).toBe(
      'Cancel'
    )
  })
})
