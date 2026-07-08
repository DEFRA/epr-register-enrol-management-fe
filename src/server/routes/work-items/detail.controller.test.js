import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import {
  clearDetailTemplateRegistry,
  registerDetailTemplate
} from '#/server/work-items/core/templates.js'
import { makeSelfAssignController } from './detail.controller.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  addWorkItemTaskNote: vi.fn()
}))

const {
  getWorkItem,
  getWorkItems,
  completeWorkItemTask,
  setWorkItemTaskStatus,
  applyWorkItemAction,
  assignWorkItem,
  unassignWorkItem,
  addWorkItemNote
} = await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '11111111-1111-1111-1111-111111111111'

function aWorkItem(overrides = {}) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    submittedAt: '2026-04-27T10:00:00Z',
    lastModifiedAt: '2026-04-27T10:05:00Z',
    submittedBy: 'frontend',
    templateVersion: 'v1',
    payload: {
      applicantName: 'Acme',
      applicationReference: 'RA-000000001',
      registrationNumber: 'REG-000000001'
    },
    tasks: [
      {
        taskId: 'check-eligibility',
        displayName: 'Check eligibility',
        isComplete: false
      }
    ],
    availableActions: [],
    ...overrides
  }
}

function registerReaccreditation() {
  registerWorkItemType({
    id: 're-accreditation',
    displayName: 'Re-accreditation',
    initialState: { id: 'submitted', displayName: 'Submitted' },
    states: [
      { id: 'submitted', displayName: 'Submitted' },
      { id: 'approved', displayName: 'Approved', isTerminal: true }
    ],
    getTasksForState: () => []
  })
}

describe('#workItemDetailController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItem.mockReset()
    getWorkItems.mockReset()
    completeWorkItemTask.mockReset()
    setWorkItemTaskStatus.mockReset()
    applyWorkItemAction.mockReset()
    assignWorkItem.mockReset()
    unassignWorkItem.mockReset()
    addWorkItemNote.mockReset()
    clearWorkItemRegistry()
    clearDetailTemplateRegistry()
  })

  test('Renders the work item with summary, tasks and a link to the audit log', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkItem).toHaveBeenCalledWith({
      workItemId: ID,
      user: expect.objectContaining({ id: expect.any(String) })
    })
    expect(result).toEqual(expect.stringContaining('Work item RA-000000001'))
    expect(result).toEqual(expect.stringContaining('Re-accreditation'))
    expect(result).toEqual(expect.stringContaining('Submitted'))
    // RA-129. Detail page is now a read-only progress summary; the task
    // list, status select and quick-complete button moved to the tasks page.
    expect(result).toEqual(expect.stringContaining('0 of 1 tasks complete'))
    expect(result).toEqual(expect.stringContaining('Tasks &amp; notes (1)'))
    expect(result).toEqual(expect.stringContaining(`/work-items/${ID}/tasks`))
    expect(result).not.toEqual(expect.stringContaining('Update status'))
    // RA-186. Payload pre block and Template version row no longer
    // render on the detail page — the payload lives with the submitted
    // audit entry instead.
    expect(result).not.toEqual(
      expect.stringContaining('data-testid="work-item-payload"')
    )
    expect(result).not.toEqual(expect.stringContaining('Template version'))
    expect(result).not.toEqual(expect.stringContaining('Acme'))
  })

  // RA-196: the caption, "Application ref" summary row and the final
  // breadcrumb show the user-facing application reference, while the
  // assign/tasks/audit-log routes keep using the internal id.
  test('Shows the application reference in the caption and summary, keeping the id in routes', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: { applicantName: 'Acme', applicationReference: 'RA-987654321' }
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Work item RA-987654321'))
    expect(result).toEqual(expect.stringContaining('Application ref'))
    expect(result).toEqual(expect.stringContaining('RA-987654321'))
    // Internal id must not appear as the caption text but still drives routes.
    expect(result).not.toEqual(expect.stringContaining(`Work item ${ID}`))
    expect(result).toEqual(expect.stringContaining(`/work-items/${ID}/tasks`))
    expect(result).toEqual(
      expect.stringContaining(`/work-items/${ID}/audit-log`)
    )
  })

  // RA-223: regulators need the Registration ID visible on the detail page.
  // It is the operator's EPR registration id, forwarded by the backend as
  // payload.operatorRegistrationId (NOT payload.registrationNumber, which is
  // the Companies House company number).
  test('RA-223: Shows the Registration ID summary row from payload.operatorRegistrationId', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicantName: 'Acme',
          applicationReference: 'RA-987654321',
          operatorRegistrationId: 'REG-100023'
        }
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    // Scope the assertion to the Registration ID row's value cell so it
    // cannot pass against the value of an unrelated summary-list row.
    expect(result).toMatch(
      /Registration ID\s*<\/dt>\s*<dd[^>]*>\s*REG-100023\s*<\/dd>/
    )
  })

  test('RA-223: Falls back to an em-dash when payload.operatorRegistrationId is missing, ignoring registrationNumber', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicantName: 'Acme',
          applicationReference: 'RA-987654321',
          // The Companies House company number must NOT leak into the
          // Registration ID row when operatorRegistrationId is absent.
          registrationNumber: 'REG-987654321'
        }
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    // The em-dash recurs in other rows, so scope the fallback assertion to
    // the Registration ID row's value cell specifically.
    expect(result).toMatch(/Registration ID\s*<\/dt>\s*<dd[^>]*>\s*—\s*<\/dd>/)
    // Guard against a regression that re-adds a registrationNumber fallback.
    expect(result).not.toMatch(
      /Registration ID\s*<\/dt>\s*<dd[^>]*>\s*REG-987654321\s*<\/dd>/
    )
  })

  // RA-245: the re-accreditation detail template previously rendered
  // payload.siteAddress inline; for form-created items that is a nested
  // { line1, line2, town, postcode } object which stringified to
  // "[object Object]". The controller now decorates the work item with
  // `siteAddressFormatted` / `sitePostcode` which the template renders.
  test('RA-245: renders a nested-object site address and nested postcode', async () => {
    registerReaccreditation()
    registerDetailTemplate(
      're-accreditation',
      'v1',
      're-accreditation/detail-v1'
    )
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          organisationName: 'Acme',
          siteAddress: {
            line1: '1 Details Lane',
            line2: '',
            town: 'Leeds',
            postcode: 'LS1 1AB'
          }
        }
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toEqual(expect.stringContaining('[object Object]'))
    expect(result).toMatch(
      /data-testid="payload-site-address">1 Details Lane, Leeds</
    )
    expect(result).toMatch(/data-testid="payload-site-postcode">LS1 1AB</)
  })

  test('RA-245: renders a legacy flat-string site address and flat postcode', async () => {
    registerReaccreditation()
    registerDetailTemplate(
      're-accreditation',
      'v1',
      're-accreditation/detail-v1'
    )
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicationReference: 'RA-000000001',
          organisationName: 'Acme',
          siteAddress: '1 Main St, Leeds, LS1 1AB',
          siteAddressPostcode: 'LS1 1AB'
        }
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toMatch(
      /data-testid="payload-site-address">1 Main St, Leeds, LS1 1AB</
    )
    expect(result).toMatch(/data-testid="payload-site-postcode">LS1 1AB</)
  })

  test('Renders task as complete (no mark-complete button) when task isComplete', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        tasks: [
          {
            taskId: 'check-eligibility',
            displayName: 'Check eligibility',
            isComplete: true
          }
        ],
        availableActions: [
          {
            actionId: 'approve',
            displayName: 'Approve',
            fromStateId: 'submitted',
            toStateId: 'approved',
            requiresAllTasksComplete: true
          }
        ]
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    // RA-129. Per-task forms moved to the tasks page; the summary just
    // shows the progress count + an Approve action when available.
    expect(result).toEqual(expect.stringContaining('1 of 1 tasks complete'))
    expect(result).not.toEqual(expect.stringContaining('Update status'))
    expect(result).toEqual(expect.stringContaining('Approve'))
    expect(result).toEqual(
      expect.stringContaining(`/work-items/${ID}/actions/approve`)
    )
  })

  test('Picks the module-registered template for the matching version', async () => {
    registerReaccreditation()
    // Register two templates; the work item's templateVersion picks v2.
    registerDetailTemplate(
      're-accreditation',
      'v1',
      'work-items/detail' // generic
    )
    registerDetailTemplate(
      're-accreditation',
      'v2',
      'work-items/detail' // shipping a different template would point elsewhere
    )

    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ templateVersion: 'v2' })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    // Detail page renders without surfacing the template version itself
    // (RA-186 removed the row from the summary); landing successfully
    // on the generic template confirms the registry lookup ran.
    expect(result).toEqual(expect.stringContaining('Work item RA-000000001'))
  })

  test('Renders 404 page when the backend reports no such work item', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Work item not found'))
    expect(result).toEqual(expect.stringContaining(ID))
  })

  test('Renders 502 page when the backend cannot be reached', async () => {
    getWorkItem.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(result).toEqual(expect.stringContaining('Work item unavailable'))
    expect(result).toEqual(expect.stringContaining('ECONNREFUSED'))
  })

  // XSS regression — epr-6fi. The detail-error banner used to splice the
  // backend error message into a govuk macro `html:` parameter raw, which
  // would execute embedded markup. Auto-escape it via a Nunjucks capture.
  test('Escapes the backend error message in the detail-error banner', async () => {
    const malicious = '<script>alert(1)</script>'
    getWorkItem.mockResolvedValue({ ok: false, error: malicious })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(result).not.toContain(malicious)
    expect(result).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  test('POST complete-task redirects to the detail page on success', async () => {
    completeWorkItemTask.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        tasks: [
          {
            taskId: 'check-eligibility',
            displayName: 'Check eligibility',
            isComplete: true
          }
        ]
      })
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/tasks/check-eligibility/complete`
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(completeWorkItemTask).toHaveBeenCalledWith({
      workItemId: ID,
      taskId: 'check-eligibility',
      user: expect.objectContaining({ id: expect.any(String) })
    })
  })

  test('POST complete-task re-renders detail with engine error inline', async () => {
    registerReaccreditation()
    completeWorkItemTask.mockResolvedValue({
      ok: false,
      status: 400,
      problem: { detail: 'Task "x" is not required' }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/tasks/x/complete`
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('Could not'))
    expect(result).toEqual(expect.stringContaining('is not required'))
  })

  test('POST set-task-status forwards the canonical status to the API and redirects on success', async () => {
    setWorkItemTaskStatus.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        tasks: [
          {
            taskId: 'check-eligibility',
            displayName: 'Check eligibility',
            isComplete: false,
            status: 'InProgress'
          }
        ]
      })
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/tasks/check-eligibility/status`,
      payload: { status: 'InProgress' }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(setWorkItemTaskStatus).toHaveBeenCalledWith({
      workItemId: ID,
      taskId: 'check-eligibility',
      status: 'InProgress',
      user: expect.objectContaining({ id: expect.any(String) })
    })
  })

  test('POST set-task-status rejects an unknown status without calling the backend', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/tasks/check-eligibility/status`,
      payload: { status: 'bogus' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('Could not'))
    expect(setWorkItemTaskStatus).not.toHaveBeenCalled()
  })

  test('POST set-task-status surfaces a 409 inline when the engine refuses', async () => {
    registerReaccreditation()
    setWorkItemTaskStatus.mockResolvedValue({
      ok: false,
      status: 409,
      problem: { detail: 'Task does not apply to this state' }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/tasks/check-eligibility/status`,
      payload: { status: 'Blocked' }
    })

    expect(statusCode).toBe(statusCodes.conflict)
    expect(result).toEqual(
      expect.stringContaining('Task does not apply to this state')
    )
  })

  test('Summary page no longer renders per-task status select even for in-progress tasks (RA-129)', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        tasks: [
          {
            taskId: 'check-eligibility',
            displayName: 'Check eligibility',
            isComplete: false,
            status: 'InProgress'
          }
        ]
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toEqual(
      expect.stringContaining('task-status-select-check-eligibility')
    )
    expect(result).not.toEqual(expect.stringContaining('Update status'))
    expect(result).toEqual(expect.stringContaining('Tasks &amp; notes (1)'))
  })

  test('Summary page does not render the per-task UI for a Blocked task (RA-129)', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        tasks: [
          {
            taskId: 'check-eligibility',
            displayName: 'Check eligibility',
            isComplete: false,
            status: 'Blocked'
          }
        ]
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toEqual(expect.stringContaining('govuk-tag--red'))
    expect(result).not.toEqual(expect.stringContaining('govuk-tag--blue'))
  })

  test('POST action redirects to the detail page on success', async () => {
    applyWorkItemAction.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ stateId: 'approved' })
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/actions/approve`
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
  })

  test('POST action surfaces 409 when engine refuses (incomplete tasks)', async () => {
    registerReaccreditation()
    applyWorkItemAction.mockResolvedValue({
      ok: false,
      status: 409,
      problem: { detail: 'Tasks outstanding' }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/actions/approve`
    })

    expect(statusCode).toBe(statusCodes.conflict)
    expect(result).toEqual(expect.stringContaining('Tasks outstanding'))
  })

  test('POST assign forwards the assignee id and a directory-resolved name to the API', async () => {
    registerReaccreditation()
    assignWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        assignedToId: 'stub-standard-1',
        assignedToName: 'Stub Standard User'
      })
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/assign`,
      payload: 'assigneeId=stub-standard-1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(assignWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        assigneeId: 'stub-standard-1',
        // The controller resolves the snapshot name from the assignable
        // users directory (stub-auth users) so the backend gets a
        // canonical name even when the form omitted it.
        assigneeName: 'Stub Standard User',
        user: expect.objectContaining({ id: expect.any(String) })
      })
    )
  })

  test('POST assign with empty assigneeId re-renders detail with an inline error', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/assign`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(
      expect.stringContaining('Choose a user to assign this work item to.')
    )
    expect(assignWorkItem).not.toHaveBeenCalled()
  })

  test('POST assign surfaces a backend 403 as inline not-authorized error', async () => {
    registerReaccreditation()
    assignWorkItem.mockResolvedValue({
      ok: false,
      status: 403,
      problem: { detail: 'Standard users can only self-assign' }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/assign`,
      payload: 'assigneeId=stub-standard-1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(result).toEqual(
      expect.stringContaining('Standard users can only self-assign')
    )
  })

  test('POST unassign clears the assignment and redirects', async () => {
    registerReaccreditation()
    unassignWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ assignedToId: null, assignedToName: null })
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/unassign`
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(unassignWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        user: expect.objectContaining({ id: expect.any(String) })
      })
    )
  })

  test('Summary page no longer shows the notes list or add-note form (RA-129)', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        notes: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            text: 'Newer note from Alice',
            createdAt: '2026-04-27T11:00:00Z',
            createdBy: 'alice-1',
            createdByName: 'Alice Example'
          }
        ]
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toEqual(expect.stringContaining('Newer note from Alice'))
    expect(result).not.toEqual(expect.stringContaining('Add a note'))
    expect(result).not.toEqual(
      expect.stringContaining(`action="/work-items/${ID}/notes"`)
    )
  })

  test('Summary page shows the read-only progress count and link to the tasks page (RA-129)', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ notes: [] })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('data-testid="work-item-task-progress"')
    )
    expect(result).toEqual(
      expect.stringContaining('data-testid="work-item-tasks-link"')
    )
    expect(result).toEqual(
      expect.stringContaining(`href="/work-items/${ID}/tasks"`)
    )
  })

  test('POST notes forwards trimmed text to the backend and redirects on success', async () => {
    addWorkItemNote.mockResolvedValue({
      ok: true,
      workItem: aWorkItem()
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/notes`,
      payload: 'text=  Spoke to applicant.  ',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}#notes`)
    expect(addWorkItemNote).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        text: 'Spoke to applicant.',
        user: expect.objectContaining({ id: expect.any(String) })
      })
    )
  })

  test('POST notes with blank text re-renders detail with an inline error and does not call the backend', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/notes`,
      payload: 'text=   ',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('Could not add note'))
    expect(result).toEqual(expect.stringContaining('Note text is required'))
    expect(addWorkItemNote).not.toHaveBeenCalled()
  })

  test('POST notes surfaces a backend 400 (e.g. over-length) inline', async () => {
    registerReaccreditation()
    addWorkItemNote.mockResolvedValue({
      ok: false,
      status: 400,
      problem: { detail: 'Note text must be 4000 characters or fewer.' }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/notes`,
      payload: 'text=non-empty-but-rejected-by-backend',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(
      expect.stringContaining('Note text must be 4000 characters or fewer.')
    )
  })

  test('Links to the standalone audit log page rather than rendering entries inline', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        auditLog: [
          {
            id: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            action: 'task-completed',
            actionDisplayName: 'Task completed',
            details: {
              taskId: 'check-eligibility',
              taskDisplayName: 'Check eligibility'
            },
            createdAt: '2026-04-27T09:00:00Z',
            createdBy: 'alice-1',
            createdByName: 'Alice Example'
          }
        ]
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('View audit log'))
    expect(result).toEqual(
      expect.stringContaining(`/work-items/${ID}/audit-log`)
    )
    // Entries are rendered on the dedicated page, not inline on the detail
    // view.
    expect(result).not.toEqual(expect.stringContaining('Task completed'))
  })

  // epr-pbk: assignment role gating must derive from the credentials
  // scope (which mirrors the route-level `requireAssign`), not from a
  // separate in-handler role lookup.
  test('Hides the assign picker for a standard-role user (canAssignAnyone false)', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ assignedToId: null, assignedToName: null })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`,
      headers: { 'x-test-user-role': 'standard' }
    })

    expect(statusCode).toBe(statusCodes.ok)
    // The assign-anyone <select> is gated behind canAssignAnyone; standard
    // users only see the self-assign affordance.
    expect(result).not.toEqual(expect.stringContaining('assign-select'))
    expect(result).not.toEqual(expect.stringContaining('unassign-submit'))
  })

  test('Shows the assign picker for an assign-role user (canAssignAnyone true)', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ assignedToId: null, assignedToName: null })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`,
      headers: { 'x-test-user-role': 'assign' }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('assign-select'))
  })

  test('POST /assign as a standard user is rejected by Hapi with 403 before the handler runs', async () => {
    const { statusCode } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/assign`,
      payload: 'assigneeId=stub-standard-1',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-test-user-role': 'standard'
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(assignWorkItem).not.toHaveBeenCalled()
  })

  test('POST /unassign as a standard user is rejected by Hapi with 403 before the handler runs', async () => {
    const { statusCode } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/unassign`,
      headers: { 'x-test-user-role': 'standard' }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(unassignWorkItem).not.toHaveBeenCalled()
  })

  describe('POST /work-items/{id}/self-assign (RA-153)', () => {
    test('Standard user GET on an unassigned work item posts to /self-assign (not /assign)', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ assignedToId: null, assignedToName: null })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`,
        headers: { 'x-test-user-role': 'standard' }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('self-assign-submit'))
      expect(result).toEqual(
        expect.stringContaining(`action="/work-items/${ID}/self-assign"`)
      )
      expect(result).not.toEqual(
        expect.stringContaining(`action="/work-items/${ID}/assign"`)
      )
      // The assignee is now derived from the session; the form must not
      // carry the previously-required hidden inputs.
      expect(result).not.toEqual(expect.stringContaining('name="assigneeId"'))
      expect(result).not.toEqual(expect.stringContaining('name="assigneeName"'))
    })

    test('Standard user self-assigns and is redirected to the detail page', async () => {
      registerReaccreditation()
      assignWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          assignedToId: 'test-standard-id',
          assignedToName: 'Test Standard User'
        })
      })

      const { statusCode, headers } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/self-assign`,
        payload: '',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-test-user-role': 'standard'
        }
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(`/work-items/${ID}`)
      expect(assignWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ID,
          assigneeId: 'test-standard-id',
          assigneeName: 'Test Standard User',
          user: expect.objectContaining({
            id: 'test-standard-id',
            name: 'Test Standard User'
          })
        })
      )
    })

    test('Assign-role user can also self-assign (the route is gated at requireStandard which assign users also have)', async () => {
      registerReaccreditation()
      assignWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          assignedToId: 'test-assign-id',
          assignedToName: 'Test Assign User'
        })
      })

      const { statusCode, headers } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/self-assign`,
        payload: '',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-test-user-role': 'assign'
        }
      })

      expect(statusCode).toBe(statusCodes.redirect)
      expect(headers.location).toBe(`/work-items/${ID}`)
      expect(assignWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId: ID,
          assigneeId: 'test-assign-id',
          assigneeName: 'Test Assign User'
        })
      )
    })

    test('Re-renders the detail page inline when the backend rejects the self-assign', async () => {
      registerReaccreditation()
      assignWorkItem.mockResolvedValue({
        ok: false,
        status: 403,
        problem: { detail: 'Not allowed to self-assign right now' }
      })
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

      const { statusCode, result } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/self-assign`,
        payload: '',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-test-user-role': 'standard'
        }
      })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(result).toEqual(
        expect.stringContaining('Could not self-assign work item')
      )
      expect(result).toEqual(
        expect.stringContaining('Not allowed to self-assign right now')
      )
    })

    test('Re-renders the detail page inline when the backend reports the work item is missing', async () => {
      registerReaccreditation()
      assignWorkItem.mockResolvedValue({
        ok: false,
        status: 404,
        problem: { detail: 'Work item not found' }
      })
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

      const { statusCode, result } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/self-assign`,
        payload: '',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-test-user-role': 'standard'
        }
      })

      // Service maps 404 to reason 'not-found' which falls through to the
      // generic 400 status path in renderDetailFromResult.
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toEqual(
        expect.stringContaining('Could not self-assign work item')
      )
      expect(result).toEqual(expect.stringContaining('Work item not found'))
    })

    test('Defensive: when the credential has no id, the handler renders the detail page and does not call the backend', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
      const stubService = { assign: vi.fn() }
      const controller = makeSelfAssignController({ service: stubService })

      const view = vi
        .fn()
        .mockReturnValue({ code: vi.fn((c) => ({ code: c })) })
      const h = { view, redirect: vi.fn() }
      const request = {
        params: { id: ID },
        payload: {},
        auth: { credentials: { name: 'No Id User' } },
        yar: { flash: () => [] }
      }

      await controller.handler(request, h)

      expect(stubService.assign).not.toHaveBeenCalled()
      expect(h.redirect).not.toHaveBeenCalled()
      expect(view).toHaveBeenCalled()
      const [, viewModel] = view.mock.calls[0]
      expect(viewModel.notice).toEqual(
        expect.objectContaining({
          kind: 'error',
          title: 'Could not self-assign work item',
          message: 'Could not identify the current user.'
        })
      )
    })
  })

  describe('RA-211 notification-failed banner', () => {
    test('renders the banner when a notification-failed audit entry is present with no later notification-sent', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          auditLog: [
            {
              action: 'notification-failed',
              createdAt: '2026-04-27T10:00:00Z',
              details: { templateKey: 'Queried' }
            }
          ]
        })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining(
          'data-testid="work-item-notification-failed-banner"'
        )
      )
    })

    test('does not render the banner for a clean notification history', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          auditLog: [
            {
              action: 'notification-sent',
              createdAt: '2026-04-27T10:00:00Z',
              details: { templateKey: 'SubmissionConfirmation' }
            }
          ]
        })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(
        expect.stringContaining(
          'data-testid="work-item-notification-failed-banner"'
        )
      )
    })

    test('does not render the banner when a later notification-sent entry for the SAME template resolves an earlier failure', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          auditLog: [
            {
              action: 'notification-failed',
              createdAt: '2026-04-27T10:00:00Z',
              details: { templateKey: 'SubmissionConfirmation' }
            },
            {
              action: 'notification-sent',
              createdAt: '2026-04-27T10:05:00Z',
              details: { templateKey: 'SubmissionConfirmation' }
            }
          ]
        })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(
        expect.stringContaining(
          'data-testid="work-item-notification-failed-banner"'
        )
      )
    })

    // RA-211: a DulyMade email succeeding must not hide a still-unresolved
    // Queried failure — they're different notifications.
    test('still renders the banner when a later notification-sent is for a DIFFERENT template', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          auditLog: [
            {
              action: 'notification-failed',
              createdAt: '2026-04-27T10:00:00Z',
              details: { templateKey: 'Queried' }
            },
            {
              action: 'notification-sent',
              createdAt: '2026-04-27T10:05:00Z',
              details: { templateKey: 'DulyMade' }
            }
          ]
        })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining(
          'data-testid="work-item-notification-failed-banner"'
        )
      )
    })

    test('does not render the banner when there is no audit log at all', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem()
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(
        expect.stringContaining(
          'data-testid="work-item-notification-failed-banner"'
        )
      )
    })
  })

  describe('RA-127 success banner from yar.flash', () => {
    test('does not render the success banner when no flash is present', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="work-item-success-banner"')
      )
    })
  })

  describe('RA-133 decision metadata rendering', () => {
    function registerReaccreditationWithDetailV1() {
      registerReaccreditation()
      registerDetailTemplate(
        're-accreditation',
        'v1',
        're-accreditation/detail-v1'
      )
    }

    test('renders the confirmation panel, ID, formatted start date and year when approved', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'approved',
          payload: {
            accreditationId: 'ACC-2027-P-AB12CD34',
            accreditationStartDate: '2027-01-01',
            accreditationYear: 2027
          }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('data-testid="re-accreditation-approval-panel"')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'data-testid="re-accreditation-approval-panel-id"'
        )
      )
      expect(result).toEqual(expect.stringContaining('ACC-2027-P-AB12CD34'))
      expect(result).toEqual(expect.stringContaining('1 January 2027'))
      expect(result).toEqual(
        expect.stringContaining(
          'data-testid="re-accreditation-accreditation-year"'
        )
      )
      expect(result).toEqual(expect.stringContaining('>2027<'))
    })

    test('RA-177: renders the issued confirmation panel and metadata above the envelope attributes', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'approved',
          payload: {
            accreditationId: 'ACC-2027-P-AB12CD34',
            accreditationStartDate: '2027-01-01',
            accreditationYear: 2027
          }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const panelIndex = result.indexOf(
        'data-testid="re-accreditation-approval-panel"'
      )
      const metadataIndex = result.indexOf(
        'data-testid="re-accreditation-decision-metadata"'
      )
      const summaryIndex = result.indexOf('data-testid="work-item-summary"')
      expect(panelIndex).toBeGreaterThan(-1)
      expect(metadataIndex).toBeGreaterThan(-1)
      expect(summaryIndex).toBeGreaterThan(-1)
      // Success message first, then its metadata, then the envelope attributes.
      expect(panelIndex).toBeLessThan(metadataIndex)
      expect(metadataIndex).toBeLessThan(summaryIndex)
    })

    test('omits decision metadata when payload has no accreditation fields', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'approved',
          payload: { applicantName: 'Acme' }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="re-accreditation-approval-panel"')
      )
      expect(result).not.toEqual(
        expect.stringContaining(
          'data-testid="re-accreditation-decision-metadata"'
        )
      )
    })

    test('falls back to the raw start date when it cannot be parsed', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'approved',
          payload: {
            accreditationId: 'ACC-2027-P-AB12CD34',
            accreditationStartDate: 'not-a-real-date',
            accreditationYear: 2027
          }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('not-a-real-date'))
    })

    test('formats an extended-JSON {$date} start date instead of rendering [object Object]', async () => {
      // RA-176: guard against a start date that arrives as MongoDB extended
      // JSON rather than a plain ISO string.
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'approved',
          payload: {
            accreditationId: 'ACC-2027-P-AB12CD34',
            accreditationStartDate: { $date: '2027-01-01T00:00:00Z' },
            accreditationYear: 2027
          }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('1 January 2027'))
      expect(result).not.toEqual(expect.stringContaining('[object Object]'))
    })

    test('renders the em-dash fallback for an unrecognised start date object shape', async () => {
      // RA-176: any non-string, non-{$date} object must not leak
      // "[object Object]" into the rendered panel.
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'approved',
          payload: {
            accreditationId: 'ACC-2027-P-AB12CD34',
            accreditationStartDate: { year: 2027, month: 1, day: 1 },
            accreditationYear: 2027
          }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(expect.stringContaining('[object Object]'))
    })

    test('renders year row with em-dash fallback when accreditationYear absent', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'approved',
          payload: {
            accreditationId: 'ACC-2027-P-AB12CD34',
            accreditationStartDate: '2027-01-01'
          }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      // The row renders but the value falls back to an em-dash because
      // the backend has not stamped a numeric accreditationYear yet.
      expect(result).toEqual(
        expect.stringContaining(
          'data-testid="re-accreditation-accreditation-year"'
        )
      )
      expect(result).toEqual(expect.stringContaining('>—<'))
    })
  })

  describe('RA-133 approve CTA eligibility (canApproveDirectly)', () => {
    function registerReaccreditationWithDetailV1() {
      registerReaccreditation()
      registerDetailTemplate(
        're-accreditation',
        'v1',
        're-accreditation/detail-v1'
      )
    }

    test('renders the Approve CTA for a decision-maker when item is in awaiting-decision state', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'awaiting-decision',
          availableActions: [
            // Backend always returns withdraw-during-decision in this state
            // (no task-completion requirement) even before reject is gated.
            {
              actionId: 'withdraw-during-decision',
              displayName: 'Withdraw',
              fromStateId: 'awaiting-decision',
              toStateId: 'withdrawn',
              requiresAllTasksComplete: false
            }
          ]
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`,
        headers: { 'x-test-user-role': 'decision-maker' }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('data-testid="action-approve"')
      )
      expect(result).toEqual(
        expect.stringContaining('data-testid="re-accreditation-approve-cta"')
      )
    })

    test('does not render the Approve CTA when item is NOT in awaiting-decision state', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId: 'submitted' })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`,
        headers: { 'x-test-user-role': 'decision-maker' }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-approve"')
      )
    })

    test('does not render the Approve CTA for a standard user who is not the assignee', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'awaiting-decision',
          assignedToId: 'someone-else'
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`,
        headers: { 'x-test-user-role': 'standard' }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-approve"')
      )
    })

    test('renders the Approve CTA when caller is the assignee even without decision-maker role', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'awaiting-decision',
          assignedToId: 'test-standard-id',
          availableActions: [
            {
              actionId: 'withdraw-during-decision',
              displayName: 'Withdraw',
              fromStateId: 'awaiting-decision',
              toStateId: 'withdrawn',
              requiresAllTasksComplete: false
            }
          ]
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`,
        headers: { 'x-test-user-role': 'standard' }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('data-testid="action-approve"')
      )
    })
  })

  test('RA-196: Falls back to using the work item id if applicationReference is missing from payload', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: { applicantName: 'Acme' } // No applicationReference
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    // Should use the ID as a fallback for the page title/caption
    expect(result).toEqual(expect.stringContaining(`Work item ${ID}`))
    // Breadcrumb should also use the ID
    expect(result).toEqual(
      expect.stringContaining(
        `<li class="govuk-breadcrumbs__list-item" aria-current="page">${ID}</li>`
      )
    )
  })
})
