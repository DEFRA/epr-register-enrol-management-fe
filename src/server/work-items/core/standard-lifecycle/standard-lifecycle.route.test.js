/**
 * RA-495. The shared Standard-workflow lifecycle pages (Duly make, Make
 * determination, Confirm applicant contact), the detail-page CTAs and the
 * pending-contact banner, used by a case type other than re-accreditation.
 *
 * Route-level: the real server, the real modules plus one test-only module
 * that opts into the Standard lifecycle, only the backend API mocked. The
 * test type supplies its own payment details and takes the default
 * (type-less) management-be lifecycle endpoints.
 */
import { vi } from 'vitest'
import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { TEST_STANDARD_USER } from '#/server/common/helpers/auth/stub-auth-plugin.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

const TEST_TYPE_ID = 'test-standard-lifecycle'

vi.mock('#/server/work-items/modules.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { standardWorkflow } =
    await import('#/server/work-items/core/standard-workflow.js')
  const { registerModuleDetailTemplates } =
    await import('#/server/work-items/core/templates.js')
  const { buildStandardLifecycleRoutes, STANDARD_LIFECYCLE_DETAIL_TEMPLATE } =
    await import('#/server/work-items/core/standard-lifecycle/routes.js')

  const type = {
    id: 'test-standard-lifecycle',
    displayName: 'Test Standard type',
    templateVersion: 'v1',
    initialState: standardWorkflow.initialState,
    states: standardWorkflow.states,
    transitions: standardWorkflow.transitions,
    standardLifecycle: {
      readPaymentDetails: (workItem) => ({
        chargePence: workItem.payload?.siteChargePence,
        paymentReference: workItem.payload?.operatorPaymentReference
      })
    }
  }
  const testModule = {
    type,
    async register(server) {
      registerModuleDetailTemplates(type.id, {
        v1: STANDARD_LIFECYCLE_DETAIL_TEMPLATE
      })
      server.route(buildStandardLifecycleRoutes(type.id))
    }
  }
  return { workItemModules: [...actual.workItemModules, testModule] }
})

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  dulyMakeWorkItem: vi.fn(),
  recordWorkItemDecision: vi.fn(),
  confirmWorkItemApplicantContact: vi.fn(),
  extendWorkItemSla: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  updateRecyclingOperations: vi.fn(),
  createWorkItem: vi.fn()
}))

const {
  getWorkItem,
  addWorkItemNote,
  applyWorkItemAction,
  dulyMakeWorkItem,
  recordWorkItemDecision,
  confirmWorkItemApplicantContact
} = await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '49500002-0000-4000-8000-000000000495'
const REF = 'TST-2026-00495'
const DETAIL_URL = `/work-items/${ID}`
const DULY_MAKE_URL = `/work-items/${TEST_TYPE_ID}/${ID}/duly-make`
const DECISION_URL = `/work-items/${TEST_TYPE_ID}/${ID}/decision`
const CONFIRM_URL = `/work-items/${TEST_TYPE_ID}/${ID}/confirm-contact`

function aWorkItem(overrides = {}) {
  const { payload, ...rest } = overrides
  const stateId = rest.stateId ?? 'submitted'
  return {
    id: ID,
    typeId: TEST_TYPE_ID,
    templateVersion: 'v1',
    stateId,
    originStateId: stateId,
    applicationReference: REF,
    submittedAt: '2026-09-01T10:00:00Z',
    lastModifiedAt: '2026-10-20T10:00:00Z',
    assignedToId: TEST_STANDARD_USER.id,
    assignedToName: TEST_STANDARD_USER.name,
    availableActions: [],
    auditLog: [],
    payload: {
      applicationReference: REF,
      siteChargePence: 98400,
      operatorPaymentReference: 'PR/PK/REP/123001',
      ...payload
    },
    ...rest
  }
}

function okWorkItem(overrides) {
  return { ok: true, workItem: aWorkItem(overrides) }
}

function squash(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function postForm(url, payload) {
  return injectWithCrumb(server, {
    method: 'POST',
    url,
    payload,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })
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
  getWorkItem.mockResolvedValue(okWorkItem())
})

describe('RA-495: Duly make for a non-re-accreditation Standard type', () => {
  test('GET renders the form with the payment details the type supplies', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DULY_MAKE_URL
    })

    expect(statusCode).toBe(statusCodes.ok)
    const $ = cheerio.load(result)
    expect(squash($('h1').text())).toBe('Duly make the application')
    expect(squash($('[data-testid="duly-making-charge-amount"]').text())).toBe(
      '£984'
    )
    expect(
      squash($('[data-testid="duly-making-payment-reference"]').text())
    ).toBe('PR/PK/REP/123001')
    expect($('[data-testid="duly-making-form"]').attr('action')).toBe(
      DULY_MAKE_URL
    )
    expect($('[data-testid="duly-making-cancel"]').attr('href')).toBe(
      DETAIL_URL
    )
  })

  test('POST duly makes through the type-less endpoint and returns to the detail page', async () => {
    dulyMakeWorkItem.mockResolvedValue(okWorkItem({ stateId: 'duly-made' }))

    const response = await postForm(
      DULY_MAKE_URL,
      'payment-date-day=1&payment-date-month=10&payment-date-year=2026'
    )

    expect(response.statusCode).toBe(statusCodes.redirect)
    expect(response.headers.location).toBe(DETAIL_URL)
    expect(dulyMakeWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID, paymentDate: '2026-10-01' })
    )
    expect(dulyMakeWorkItem.mock.calls[0][0]).not.toHaveProperty('typeSegment')
  })

  test('POST re-renders a payment-date error in place without calling the backend', async () => {
    const response = await postForm(DULY_MAKE_URL, 'payment-date-day=')

    expect(response.statusCode).toBe(statusCodes.badRequest)
    const $ = cheerio.load(response.result)
    expect($('[data-testid="duly-making-error-summary"]').length).toBe(1)
    expect($('[data-testid="duly-making-form"]').attr('action')).toBe(
      DULY_MAKE_URL
    )
    expect(
      squash($('[data-testid="duly-making-payment-reference"]').text())
    ).toBe('PR/PK/REP/123001')
    expect(dulyMakeWorkItem).not.toHaveBeenCalled()
  })
})

describe('RA-495: the type scopes its own pages', () => {
  test.each([DULY_MAKE_URL, DECISION_URL, CONFIRM_URL])(
    'GET %s redirects a work item of another type to its detail page',
    async (url) => {
      getWorkItem.mockResolvedValue(
        okWorkItem({ typeId: 're-accreditation', stateId: 'submitted' })
      )

      const response = await server.inject({ method: 'GET', url })

      expect(response.statusCode).toBe(statusCodes.redirect)
      expect(response.headers.location).toBe(DETAIL_URL)
    }
  )

  test('a re-accreditation page redirects a work item of the test type', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/work-items/re-accreditation/${ID}/duly-make`
    })

    expect(response.statusCode).toBe(statusCodes.redirect)
    expect(response.headers.location).toBe(DETAIL_URL)
  })

  test('a type that has not mounted the lifecycle pages has none', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/work-items/not-a-standard-type/${ID}/duly-make`
    })

    expect(response.statusCode).toBe(statusCodes.notFound)
  })
})

describe('RA-495: Make determination for a non-re-accreditation Standard type', () => {
  test('GET renders the radio page for a decidable work item', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ stateId: 'assessment-in-progress' })
    )

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DECISION_URL
    })

    expect(statusCode).toBe(statusCodes.ok)
    const $ = cheerio.load(result)
    expect(squash($('h1').text())).toBe('Make determination')
    expect($('[data-testid="log-decision-form"]').attr('action')).toBe(
      DECISION_URL
    )
    expect($('[data-testid="decision-approved"]').length).toBe(1)
    expect($('[data-testid="decision-refused"]').length).toBe(1)
  })

  test('GET redirects a work item that is not yet duly made', async () => {
    const response = await server.inject({ method: 'GET', url: DECISION_URL })

    expect(response.statusCode).toBe(statusCodes.redirect)
    expect(response.headers.location).toBe(DETAIL_URL)
  })

  test('POST records the note and the decision through the type-less endpoint', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ stateId: 'assessment-in-progress' })
    )
    addWorkItemNote.mockResolvedValue({ ok: true })
    recordWorkItemDecision.mockResolvedValue(
      okWorkItem({ stateId: 'rejected-pending-contact' })
    )

    const response = await postForm(
      DECISION_URL,
      'decision=rejected&decisionNote=Site%20not%20eligible'
    )

    expect(response.statusCode).toBe(statusCodes.redirect)
    expect(response.headers.location).toBe(DETAIL_URL)
    expect(addWorkItemNote).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID, text: 'Site not eligible' })
    )
    expect(recordWorkItemDecision).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID, outcome: 'rejected' })
    )
    expect(recordWorkItemDecision.mock.calls[0][0]).not.toHaveProperty(
      'typeSegment'
    )
  })

  test('POST starts assessment first for a Duly made work item', async () => {
    getWorkItem.mockResolvedValue(okWorkItem({ stateId: 'duly-made' }))
    applyWorkItemAction.mockResolvedValue(
      okWorkItem({ stateId: 'assessment-started' })
    )
    recordWorkItemDecision.mockResolvedValue(
      okWorkItem({ stateId: 'approved-pending-contact' })
    )

    const response = await postForm(DECISION_URL, 'decision=approved')

    expect(response.statusCode).toBe(statusCodes.redirect)
    expect(applyWorkItemAction).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID, actionId: 'start-assessment' })
    )
    expect(recordWorkItemDecision).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID, outcome: 'approved' })
    )
  })
})

describe('RA-495: the detail page of a non-re-accreditation Standard type', () => {
  async function renderDetail(overrides) {
    getWorkItem.mockResolvedValue(okWorkItem(overrides))
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: DETAIL_URL
    })
    expect(statusCode).toBe(statusCodes.ok)
    return cheerio.load(result)
  }

  test('a Not started item offers Duly make, linking to the type’s page', async () => {
    const $ = await renderDetail({ stateId: 'submitted' })

    const cta = $('[data-testid="duly-make-cta"]')
    expect(squash(cta.text())).toBe('Duly make')
    expect(cta.attr('href')).toBe(DULY_MAKE_URL)
    expect($('[data-testid="log-decision-cta"]').length).toBe(0)
    // Query stays re-accreditation-only.
    expect($('[data-testid="action-query"]').length).toBe(0)
  })

  test('a Duly made item offers Make Determination, linking to the type’s page', async () => {
    const $ = await renderDetail({ stateId: 'duly-made' })

    const cta = $('[data-testid="log-decision-cta"]')
    expect(squash(cta.text())).toBe('Make Determination')
    expect(cta.attr('href')).toBe(DECISION_URL)
    expect($('[data-testid="duly-make-cta"]').length).toBe(0)
  })

  test('a determination pending contact shows the banner and only Confirm applicant contact', async () => {
    const $ = await renderDetail({
      stateId: 'approved-pending-contact',
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

    const banner = $(
      '[data-testid="standard-lifecycle-pending-contact-banner"]'
    )
    expect(squash(banner.text())).toContain('Application approved')
    expect(squash(banner.text())).toContain(
      'You now need to contact the applicant about the decision.'
    )
    const cta = $('[data-testid="confirm-applicant-contact-cta"]')
    expect(cta.attr('href')).toBe(CONFIRM_URL)
    expect($('[data-testid="log-decision-cta"]').length).toBe(0)
    expect($('[data-testid="action-sla-extend"]').length).toBe(0)
  })

  test('a refusal pending contact shows the refused banner', async () => {
    const $ = await renderDetail({ stateId: 'rejected-pending-contact' })

    expect(
      squash(
        $('[data-testid="standard-lifecycle-pending-contact-banner"]').text()
      )
    ).toContain('Application refused')
    expect(
      $('[data-testid="standard-lifecycle-pending-contact-accreditation-id"]')
        .length
    ).toBe(0)
  })

  test.each([
    ['approved', 'Granted', 'govuk-tag--green'],
    ['rejected', 'Refused', 'govuk-tag--red']
  ])(
    'a closed %s item shows the Standard-workflow outcome tag and no actions',
    async (stateId, label, tagClass) => {
      const $ = await renderDetail({ stateId })

      expect(
        $('[data-testid="standard-lifecycle-readonly-actions"]').length
      ).toBe(1)
      const tag = $('[data-testid="standard-lifecycle-state-tag"]')
      expect(squash(tag.text())).toBe(label)
      expect(tag.hasClass(tagClass)).toBe(true)
      expect($('[data-testid="confirm-applicant-contact-cta"]').length).toBe(0)
      expect($('[data-testid="assignment-closed"]').length).toBe(1)
    }
  )
})

describe('RA-495: Confirm applicant contact for a non-re-accreditation Standard type', () => {
  test('GET renders the confirm page for a work item pending contact', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ stateId: 'approved-pending-contact' })
    )

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: CONFIRM_URL
    })

    expect(statusCode).toBe(statusCodes.ok)
    const $ = cheerio.load(result)
    expect(squash($('h1').text())).toBe('Confirm applicant contact')
    expect($('[data-testid="confirm-contact-form"]').attr('action')).toBe(
      CONFIRM_URL
    )
  })

  test('GET redirects a work item that is not pending contact', async () => {
    const response = await server.inject({ method: 'GET', url: CONFIRM_URL })

    expect(response.statusCode).toBe(statusCodes.redirect)
    expect(response.headers.location).toBe(DETAIL_URL)
  })

  test('POST applies the determination through the type-less endpoint', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ stateId: 'rejected-pending-contact' })
    )
    confirmWorkItemApplicantContact.mockResolvedValue(
      okWorkItem({ stateId: 'rejected' })
    )

    const response = await postForm(CONFIRM_URL, 'applicantContacted=yes')

    expect(response.statusCode).toBe(statusCodes.redirect)
    expect(response.headers.location).toBe(DETAIL_URL)
    expect(confirmWorkItemApplicantContact).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID })
    )
    expect(confirmWorkItemApplicantContact.mock.calls[0][0]).not.toHaveProperty(
      'typeSegment'
    )
  })

  test('POST re-renders with a retryable failure banner when the backend fails', async () => {
    getWorkItem.mockResolvedValue(
      okWorkItem({ stateId: 'approved-pending-contact' })
    )
    confirmWorkItemApplicantContact.mockResolvedValue({
      ok: false,
      reason: 'server',
      status: 500
    })

    const response = await postForm(CONFIRM_URL, 'applicantContacted=yes')

    expect(response.statusCode).toBe(statusCodes.badGateway)
    const $ = cheerio.load(response.result)
    expect(
      squash($('[data-testid="confirm-contact-failure-banner"]').text())
    ).toContain('Nothing has been changed. Try again.')
  })
})
