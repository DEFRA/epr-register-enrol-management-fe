/**
 * RA-527 (task 004). Step 2 of the two-step determination: the regulator
 * confirms they have contacted the applicant, and only then is the outcome
 * applied. GET renders the confirm page; POST validates the checkbox and
 * calls management-be's `/confirm-contact`.
 *
 * Route-level: the real server, the real re-accreditation declaration and
 * templates, only the backend API mocked, so this asserts what a regulator
 * reads and what reaches the backend.
 */
import { vi } from 'vitest'
import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { TEST_STANDARD_USER } from '#/server/common/helpers/auth/stub-auth-plugin.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

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

const { getWorkItem, confirmApplicantContact } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '52700004-0000-4000-8000-000000000527'
const REF = 'RA-000000527'
const DETAIL_URL = `/work-items/${ID}`
const CONFIRM_URL = `/work-items/re-accreditation/${ID}/confirm-contact`
const ERROR_MESSAGE =
  'Confirm you have contacted the applicant about the decision'

function aWorkItem(overrides = {}) {
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
      applicationReference: REF,
      accreditationId: 'A26ER5000270036WO',
      accreditationStartDate: '2026-10-20',
      accreditationYear: 2026
    },
    availableActions: [],
    ...overrides
  }
}

function squash(text) {
  return text.replace(/\s+/g, ' ').trim()
}

let server

async function getConfirmPage({ headers } = {}) {
  return server.inject({ method: 'GET', url: CONFIRM_URL, headers })
}

async function postConfirm(payload = 'applicantContacted=yes', headers = {}) {
  return injectWithCrumb(server, {
    method: 'POST',
    url: CONFIRM_URL,
    payload,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers
    }
  })
}

function sessionCookie(response) {
  return []
    .concat(response.headers['set-cookie'] ?? [])
    .map((header) => header.split(';')[0])
    .join('; ')
}

describe('RA-527: confirm applicant contact', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
  })

  describe('GET', () => {
    test('renders the Design 3 confirm page', async () => {
      const { statusCode, result } = await getConfirmPage()

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)

      expect(squash($('h1').text())).toBe('Confirm applicant contact')
      expect(squash($('[data-testid="app-heading-caption"]').text())).toBe(
        `Application number: ${REF}`
      )
      const crumbs = $('.govuk-breadcrumbs__list-item')
        .map((_, el) => squash($(el).text()))
        .get()
      expect(crumbs).toEqual(['Work items', REF, 'Confirm applicant contact'])
      expect($('.govuk-breadcrumbs__list-item a').eq(1).attr('href')).toBe(
        DETAIL_URL
      )

      const form = $('[data-testid="confirm-contact-form"]')
      expect(form.attr('method')).toBe('post')
      expect(form.attr('action')).toBe(CONFIRM_URL)

      const checkbox = $('[data-testid="confirm-contact-checkbox"]')
      expect(checkbox.attr('type')).toBe('checkbox')
      expect(checkbox.attr('name')).toBe('applicantContacted')
      expect(checkbox.attr('checked')).toBeUndefined()
      expect(squash($(`label[for="${checkbox.attr('id')}"]`).text())).toBe(
        'I have contacted the applicant about the decision'
      )

      const submit = $('[data-testid="confirm-contact-submit"]')
      expect(squash(submit.text())).toBe('Confirm and continue')
      expect(submit.attr('disabled')).toBeUndefined()

      const cancel = $('[data-testid="confirm-contact-cancel"]')
      expect(squash(cancel.text())).toBe('Cancel')
      expect(cancel.attr('href')).toBe(DETAIL_URL)

      expect($('[data-testid="confirm-contact-error-summary"]').length).toBe(0)
      expect($('[data-testid="confirm-contact-failure-banner"]').length).toBe(0)
    })

    test('shows a read-only user the page with every control disabled', async () => {
      const { statusCode, result } = await getConfirmPage({
        headers: { 'x-test-user-role': 'support-readonly' }
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect(
        $('[data-testid="confirm-contact-checkbox"]').attr('disabled')
      ).toBeDefined()
      expect(
        $('[data-testid="confirm-contact-submit"]').attr('disabled')
      ).toBeDefined()
    })

    test.each([
      'assessment-in-progress',
      'awaiting-decision',
      'approved',
      'rejected'
    ])('redirects to the detail page for an item in %s', async (stateId) => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId })
      })

      const response = await getConfirmPage()

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe(DETAIL_URL)
    })

    test('redirects to the detail page for a work item of another type', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ typeId: 'some-other-type' })
      })

      const response = await getConfirmPage()

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe(DETAIL_URL)
    })

    test('renders not found for an unknown work item', async () => {
      getWorkItem.mockResolvedValue({ ok: false, status: 404 })

      const response = await getConfirmPage()

      expect(response.statusCode).toBe(statusCodes.notFound)
    })
  })

  describe('POST', () => {
    test('an unticked box re-renders the page with an error summary and an inline error, and changes nothing', async () => {
      const response = await postConfirm('')

      expect(response.statusCode).toBe(statusCodes.badRequest)
      const $ = cheerio.load(response.result)
      const summary = $('[data-testid="confirm-contact-error-summary"]')
      expect(squash(summary.text())).toContain('There is a problem')
      expect(squash(summary.text())).toContain(ERROR_MESSAGE)
      const checkbox = $('[data-testid="confirm-contact-checkbox"]')
      expect(summary.find('a').attr('href')).toBe(`#${checkbox.attr('id')}`)
      expect(
        squash($('[data-testid="confirm-contact-error"]').text())
      ).toContain(ERROR_MESSAGE)
      expect($('title').text().trim()).toMatch(/^Error: /)
      expect(confirmApplicantContact).not.toHaveBeenCalled()
    })

    test('a ticked box confirms contact, then the detail page shows the "Applicant contacted" banner once', async () => {
      confirmApplicantContact.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId: 'approved' })
      })

      const posted = await postConfirm()

      expect(confirmApplicantContact).toHaveBeenCalledWith({
        workItemId: ID,
        user: expect.objectContaining({ id: TEST_STANDARD_USER.id })
      })
      expect(posted.statusCode).toBe(statusCodes.redirect)
      expect(posted.headers.location).toBe(DETAIL_URL)

      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId: 'approved' })
      })
      const cookie = sessionCookie(posted)
      const first = await server.inject({
        method: 'GET',
        url: DETAIL_URL,
        headers: { cookie }
      })
      const $ = cheerio.load(first.result)
      const banner = $('[data-testid="work-item-flash-banner"]')
      expect(banner.hasClass('govuk-notification-banner--success')).toBe(true)
      expect(
        squash(banner.find('.govuk-notification-banner__title').text())
      ).toBe('Applicant contacted')
      expect(
        squash(banner.find('.govuk-notification-banner__content').text())
      ).toBe('The applicant has been contacted and accreditation is granted.')

      // One-time: the next visit shows the settled outcome only.
      const second = await server.inject({
        method: 'GET',
        url: DETAIL_URL,
        headers: { cookie: [cookie, sessionCookie(first)].join('; ') }
      })
      expect(
        cheerio.load(second.result)('[data-testid="work-item-flash-banner"]')
          .length
      ).toBe(0)
    })

    test.each(['assessment-in-progress', 'approved', 'rejected'])(
      'an item in %s is redirected to the detail page without calling the backend',
      async (stateId) => {
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: aWorkItem({ stateId })
        })

        const response = await postConfirm()

        expect(response.statusCode).toBe(statusCodes.redirect)
        expect(response.headers.location).toBe(DETAIL_URL)
        expect(confirmApplicantContact).not.toHaveBeenCalled()
      }
    )

    test('a backend failure shows an error banner on the page and nothing changes', async () => {
      confirmApplicantContact.mockResolvedValue({
        ok: false,
        reason: 'server',
        status: 500,
        message: 'The operator journey could not be notified.'
      })

      const response = await postConfirm()

      expect(response.statusCode).not.toBe(statusCodes.redirect)
      const $ = cheerio.load(response.result)
      const banner = $('[data-testid="confirm-contact-failure-banner"]')
      expect(banner.length).toBe(1)
      expect(squash(banner.text())).toContain(
        'Could not confirm applicant contact'
      )
      expect(squash(banner.text())).toContain('Nothing has been changed')
      // The page is still there to retry from.
      expect($('[data-testid="confirm-contact-submit"]').length).toBe(1)
    })

    test('a conflict (the application changed) shows a refresh banner', async () => {
      confirmApplicantContact.mockResolvedValue({
        ok: false,
        reason: 'conflict',
        status: 409,
        message: 'Not pending contact'
      })

      const response = await postConfirm()

      const $ = cheerio.load(response.result)
      expect(
        squash($('[data-testid="confirm-contact-failure-banner"]').text())
      ).toContain('This application has changed since you opened it.')
    })

    test('a read-only user cannot confirm', async () => {
      const response = await postConfirm('applicantContacted=yes', {
        'x-test-user-role': 'support-readonly'
      })

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(confirmApplicantContact).not.toHaveBeenCalled()
    })
  })
})

/**
 * RA-527 (task 005). The confirm page works identically after a refusal at
 * step 1; only the one-time success banner's wording differs.
 */
describe('RA-527: confirm applicant contact after a refusal', () => {
  function aRefusalItem(overrides = {}) {
    return aWorkItem({
      stateId: 'rejected-pending-contact',
      payload: { applicationReference: REF },
      ...overrides
    })
  }

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aRefusalItem()
    })
  })

  test('GET renders the same confirm page', async () => {
    const { statusCode, result } = await getConfirmPage()

    expect(statusCode).toBe(statusCodes.ok)
    const $ = cheerio.load(result)
    expect(squash($('h1').text())).toBe('Confirm applicant contact')
    expect(squash($('[data-testid="app-heading-caption"]').text())).toBe(
      `Application number: ${REF}`
    )
    expect($('[data-testid="confirm-contact-checkbox"]').length).toBe(1)
    expect(squash($('[data-testid="confirm-contact-submit"]').text())).toBe(
      'Confirm and continue'
    )
    expect($('[data-testid="confirm-contact-cancel"]').attr('href')).toBe(
      DETAIL_URL
    )
  })

  test('an unticked box shows the same error and changes nothing', async () => {
    const response = await postConfirm('')

    expect(response.statusCode).toBe(statusCodes.badRequest)
    expect(
      squash(
        cheerio
          .load(response.result)('[data-testid="confirm-contact-error"]')
          .text()
      )
    ).toContain(ERROR_MESSAGE)
    expect(confirmApplicantContact).not.toHaveBeenCalled()
  })

  test('a ticked box confirms contact, then the detail page shows "accreditation is refused" once', async () => {
    confirmApplicantContact.mockResolvedValue({
      ok: true,
      workItem: aRefusalItem({ stateId: 'rejected' })
    })

    const posted = await postConfirm()

    expect(confirmApplicantContact).toHaveBeenCalledWith({
      workItemId: ID,
      user: expect.objectContaining({ id: TEST_STANDARD_USER.id })
    })
    expect(posted.statusCode).toBe(statusCodes.redirect)
    expect(posted.headers.location).toBe(DETAIL_URL)

    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aRefusalItem({ stateId: 'rejected' })
    })
    const cookie = sessionCookie(posted)
    const first = await server.inject({
      method: 'GET',
      url: DETAIL_URL,
      headers: { cookie }
    })
    const $ = cheerio.load(first.result)
    const banner = $('[data-testid="work-item-flash-banner"]')
    expect(banner.hasClass('govuk-notification-banner--success')).toBe(true)
    expect(
      squash(banner.find('.govuk-notification-banner__title').text())
    ).toBe('Applicant contacted')
    expect(
      squash(banner.find('.govuk-notification-banner__content').text())
    ).toBe('The applicant has been contacted and accreditation is refused.')

    const second = await server.inject({
      method: 'GET',
      url: DETAIL_URL,
      headers: { cookie: [cookie, sessionCookie(first)].join('; ') }
    })
    expect(
      cheerio.load(second.result)('[data-testid="work-item-flash-banner"]')
        .length
    ).toBe(0)
  })
})
