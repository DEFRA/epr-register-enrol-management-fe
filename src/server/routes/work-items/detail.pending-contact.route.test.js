/**
 * RA-527 (task 003). The detail page of a re-accreditation approved at step 1
 * of the two-step determination (`approved-pending-contact`): the regulator
 * has approved and the accreditation number is minted, but the applicant has
 * not been contacted yet, so nothing is applied.
 *
 * Route-level: the real server, the real re-accreditation declaration and
 * template, only the backend API mocked, so this asserts what a regulator
 * actually reads and can click.
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

const ID = '52700003-0000-4000-8000-000000000527'
const DETAIL_URL = `/work-items/${ID}`
const ACCREDITATION_ID = 'A26ER5000270036WO'

function aPendingContactItem(overrides = {}) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'approved-pending-contact',
    templateVersion: 'v17',
    submittedAt: '2026-09-01T10:00:00Z',
    lastModifiedAt: '2026-10-20T10:00:00Z',
    assignedToId: TEST_STANDARD_USER.id,
    assignedToName: TEST_STANDARD_USER.name,
    payload: {
      applicationReference: 'RA-000000527',
      accreditationId: ACCREDITATION_ID,
      accreditationStartDate: '2026-10-20',
      accreditationYear: 2026
    },
    // management-be projects nothing from this state: no query, withdraw,
    // due-date change or re-determination.
    availableActions: [],
    ...overrides
  }
}

function squash(text) {
  return text.replace(/\s+/g, ' ').trim()
}

let server

async function renderDetail({
  workItem = aPendingContactItem(),
  headers
} = {}) {
  getWorkItem.mockResolvedValue({ ok: true, workItem })
  const { statusCode, result } = await server.inject({
    method: 'GET',
    url: DETAIL_URL,
    headers
  })
  expect(statusCode).toBe(statusCodes.ok)
  return cheerio.load(result)
}

describe('RA-527: detail page while an approval is pending applicant contact', () => {
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

  test('the status tag reads "Approved" in light blue', async () => {
    const $ = await renderDetail()

    const tag = $('[data-testid="work-item-state-tag"]')
    expect(squash(tag.text())).toBe('Approved')
    expect(tag.hasClass('govuk-tag--light-blue')).toBe(true)
  })

  test('shows the persistent "Application approved" banner with the accreditation ID', async () => {
    const $ = await renderDetail()

    const banner = $('[data-testid="re-accreditation-pending-contact-banner"]')
    expect(banner.length).toBe(1)
    // Green success banner, not the red error treatment.
    expect(banner.hasClass('govuk-notification-banner--success')).toBe(true)
    expect(
      squash(banner.find('.govuk-notification-banner__title').text())
    ).toBe('Application approved')
    const body = squash(
      banner.find('.govuk-notification-banner__content').text()
    )
    expect(body).toContain(
      'The application was approved. You now need to contact the applicant about the decision.'
    )
    expect(body).toContain(`Accreditation ID: ${ACCREDITATION_ID}`)
    expect(
      squash(
        banner
          .find(
            '[data-testid="re-accreditation-pending-contact-accreditation-id"]'
          )
          .text()
      )
    ).toBe(ACCREDITATION_ID)
  })

  test('the banner is persistent: it shows on every visit, not from a flash', async () => {
    await renderDetail()
    const $ = await renderDetail()

    expect(
      $('[data-testid="re-accreditation-pending-contact-banner"]').length
    ).toBe(1)
    expect($('[data-testid="work-item-flash-banner"]').length).toBe(0)
  })

  test('shows the accreditation ID, start date and year rows', async () => {
    const $ = await renderDetail()

    expect(
      squash($('[data-testid="re-accreditation-accreditation-id"]').text())
    ).toBe(ACCREDITATION_ID)
    expect(
      squash(
        $('[data-testid="re-accreditation-accreditation-start-date"]').text()
      )
    ).toBe('20 October 2026')
    expect(
      squash($('[data-testid="re-accreditation-accreditation-year"]').text())
    ).toBe('2026')
    // The outcome is not applied yet, so nothing says it has been issued.
    expect($('[data-testid="re-accreditation-approval-panel"]').length).toBe(0)
  })

  test('the assignment box offers only Reassign and Unassign', async () => {
    const $ = await renderDetail()

    const panel = $('[data-testid="case-assignment-panel"]')
    expect(
      squash(panel.find('[data-testid="assignment-current"]').text())
    ).toBe('Assigned to you')
    expect(panel.find('[data-testid="reassign-link"]').length).toBe(1)
    expect(panel.find('[data-testid="unassign-link"]').length).toBe(1)
    expect(panel.find('[data-testid="self-assign-submit"]').length).toBe(0)
    expect(panel.find('[data-testid="action-sla-extend"]').length).toBe(0)
    expect(panel.find('[data-testid="assignment-closed"]').length).toBe(0)
  })

  test('a colleague holding the item is not offered "Assign to yourself and start"', async () => {
    const $ = await renderDetail({
      workItem: aPendingContactItem({
        assignedToId: 'colleague-1',
        assignedToName: 'Colleague One'
      })
    })

    const panel = $('[data-testid="case-assignment-panel"]')
    expect(panel.find('[data-testid="self-assign-submit"]').length).toBe(0)
    expect(panel.find('[data-testid="reassign-link"]').length).toBe(1)
    expect(panel.find('[data-testid="unassign-link"]').length).toBe(1)
  })

  test('a separate box carries the primary "Confirm applicant contact" button', async () => {
    const $ = await renderDetail()

    const box = $('[data-testid="actions-panel"]')
    const button = box.find('[data-testid="confirm-applicant-contact-cta"]')
    expect(button.length).toBe(1)
    expect(squash(button.text())).toBe('Confirm applicant contact')
    expect(button.is('a')).toBe(true)
    expect(button.attr('href')).toBe(
      `/work-items/re-accreditation/${ID}/confirm-contact`
    )
    expect(button.hasClass('govuk-button')).toBe(true)
    expect(button.hasClass('govuk-button--secondary')).toBe(false)
    // It is the only thing in that box.
    expect(box.find('[data-testid="work-item-no-actions"]').length).toBe(0)
    expect(
      box.find('[data-testid="re-accreditation-readonly-actions"]').length
    ).toBe(0)
  })

  test('the Confirm button is disabled for a read-only user', async () => {
    const $ = await renderDetail({
      headers: { 'x-test-user-role': 'support-readonly' }
    })

    const button = $('[data-testid="confirm-applicant-contact-cta"]')
    expect(button.length).toBe(1)
    expect(button.is('a')).toBe(false)
    expect(button.attr('href')).toBeUndefined()
    expect(button.hasClass('app-action-link--disabled')).toBe(true)
  })

  test('hides Make determination, Query and the due-date link', async () => {
    const $ = await renderDetail({
      // Even if a stale backend projected them, none of these may render.
      workItem: aPendingContactItem({
        availableActions: [
          {
            actionId: 'sla-extend',
            displayName: 'Extend SLA',
            fromStateId: 'approved-pending-contact',
            toStateId: 'approved-pending-contact',
            callerInvocable: true
          }
        ]
      })
    })

    expect($('[data-testid="log-decision-cta"]').length).toBe(0)
    expect($('[data-testid="action-query"]').length).toBe(0)
    expect($('[data-testid="action-sla-extend"]').length).toBe(0)
    expect($('[data-testid="duly-make-cta"]').length).toBe(0)
    expect($('[data-testid="action-continue-review"]').length).toBe(0)
  })

  test('nothing pending-contact renders on a Granted item', async () => {
    const $ = await renderDetail({
      workItem: aPendingContactItem({ stateId: 'approved' })
    })

    expect(
      $('[data-testid="re-accreditation-pending-contact-banner"]').length
    ).toBe(0)
    expect($('[data-testid="confirm-applicant-contact-cta"]').length).toBe(0)
    expect($('[data-testid="re-accreditation-approval-panel"]').length).toBe(1)
  })
})
