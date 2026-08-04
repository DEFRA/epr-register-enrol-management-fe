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
import { TEST_STANDARD_USER } from '#/server/common/helpers/auth/stub-auth-plugin.js'
import { reAccreditationType } from '#/server/work-items/re-accreditation/module.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  getBackendHealth: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn()
}))

const {
  getWorkItem,
  getReAccreditationPriorYear,
  getWorkItems,
  completeWorkItemTask,
  setWorkItemTaskStatus,
  applyWorkItemAction,
  assignWorkItem,
  unassignWorkItem
} = await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '11111111-1111-1111-1111-111111111111'

/**
 * Extract the rendered HTML of a single AC02 application-details row, so an
 * assertion about (say) the site address cannot accidentally pass against
 * text that happens to appear elsewhere on the page.
 */
function detailRow(html, key) {
  const start = html.indexOf(`data-testid="app-detail-row-${key}"`)
  // THROW rather than returning '' for a missing row. An empty string
  // silently satisfies every `.not.toContain(...)` assertion, so a row that
  // vanished entirely would read as a pass — the same vacuous-green failure
  // mode as the SLA badge test that supplies a live `slaState` before
  // asserting absence. A negative assertion is only meaningful once the
  // thing it is scoped to is known to exist.
  if (start === -1) {
    throw new Error(
      `No application-details row "${key}" in the rendered page — a scoped assertion against it would pass vacuously.`
    )
  }
  const end = html.indexOf('</div>', start)
  return html.slice(start, end === -1 ? undefined : end)
}

function siteAddressRow(html) {
  return detailRow(html, 'site-address')
}

/**
 * Extract the rendered RA-358 withdrawn notice (a govuk error summary:
 * outer div → role="alert" → title → body → `<ul>` of items), so a
 * "the Guid is not in here" assertion is scoped to the notice and cannot
 * pass merely because the id moved elsewhere on the page. The detail page
 * legitimately still carries the work-item id in its reference footer.
 *
 * THROWS when the notice is absent, for the same reason `detailRow` does:
 * a negative assertion scoped to a missing element passes vacuously.
 */
function withdrawnNotice(html) {
  const start = html.indexOf('data-testid="work-item-withdrawn-notice"')
  if (start === -1) {
    throw new Error(
      'No withdrawn notice in the rendered page — a scoped assertion against it would pass vacuously.'
    )
  }
  const end = html.indexOf('</ul>', start)
  return html.slice(start, end === -1 ? undefined : end)
}

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
    expect(result).toEqual(expect.stringContaining('Tasks (1)'))
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

  // RA-324 (AC08). The State row renders as a coloured govuk-tag using the
  // shared state-badge colours, so the detail page and the Applications list
  // colour a given status identically.
  test('Renders the State as a coloured badge matching the shared colours', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ stateId: 'approved' })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    // RA-295: the status badge moved into the case header's meta line, but
    // keeps the shared testid and the shared colour contract.
    const badgeIdx = result.indexOf('data-testid="work-item-state-tag"')
    expect(badgeIdx).toBeGreaterThan(-1)
    // ...and approved renders green (the contract colour), never a plain
    // uncoloured value.
    expect(result.slice(badgeIdx - 120, badgeIdx)).toContain('govuk-tag--green')
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
    // RA-295 moved this row into the reference block at the bottom of the
    // page and relabelled it "Operator registration ID", to disambiguate it
    // from the "Registration number" the case header now shows. Scope the
    // assertion to that row's value cell so it cannot pass against the value
    // of an unrelated row.
    expect(result).toMatch(
      /Operator registration ID\s*<\/dt>\s*<dd[^>]*>\s*REG-100023\s*<\/dd>/
    )
  })

  test('RA-223: Omits the Operator registration ID row when absent, never falling back to registrationNumber', async () => {
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
    // RA-295: the reference block omits rows with no value rather than
    // rendering an em dash, so the row must not appear at all...
    expect(result).not.toMatch(/Operator registration ID\s*<\/dt>/)
    // ...and in particular the Companies House registration number must
    // never leak into it (guards the RA-223 regression).
    expect(result).not.toMatch(
      /Operator registration ID\s*<\/dt>\s*<dd[^>]*>\s*REG-987654321\s*<\/dd>/
    )
    // The registration number itself still renders — in the case header,
    // where it belongs (AC01).
    expect(result).toMatch(
      /data-testid="case-header-registration-number">\s*REG-987654321\s*</
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
    // RA-295: the site address is the first AC02 row; the nested shape keeps
    // the postcode out of the formatted line, so it renders as a second line.
    const row = siteAddressRow(result)
    expect(row).toContain('1 Details Lane, Leeds')
    expect(row).toContain('LS1 1AB')
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
    // The legacy flat string already contains the postcode, so it must not
    // be repeated as a second line.
    const row = siteAddressRow(result)
    expect(row).toContain('1 Main St, Leeds, LS1 1AB')
    expect(row.match(/LS1 1AB/g)).toHaveLength(1)
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
    expect(result).toEqual(expect.stringContaining('Application not found'))
    // RA-358 AC2. The id survives ONLY as explicitly-labelled diagnostic
    // detail in its own element — never as the heading caption, the subject
    // of the body copy or an emphasised value.
    expect(result).toEqual(expect.stringContaining(ID))
    expect(result).not.toEqual(expect.stringContaining('No work item exists'))
    expect(result).not.toEqual(expect.stringContaining(`Work item ${ID}`))
    expect(result).not.toEqual(
      expect.stringContaining(`<strong>${ID}</strong>`)
    )
    expect(result).toEqual(
      expect.stringContaining('work-item-not-found-diagnostic')
    )
  })

  // RA-358 AC2. The 404 page must read in application terms: the reworded
  // body copy and the help / back links replace the old GUID-led sentence.
  test('404 page is worded in application terms with no GUID caption', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).toEqual(
      expect.stringContaining('This application could not be found')
    )
    expect(result).toEqual(expect.stringContaining('work-item-not-found-help'))
    expect(result).toEqual(expect.stringContaining('Back to all applications'))
    // The heading caption element is not rendered at all now that it has no
    // GUID to carry.
    expect(result).not.toEqual(expect.stringContaining('app-heading-caption'))
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
    expect(result).toEqual(expect.stringContaining('Tasks (1)'))
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
        assignedToId: 'stub-caseworker-1',
        assignedToName: 'Stub Caseworker One'
      })
    })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/assign`,
      payload: 'assigneeId=stub-caseworker-1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(assignWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        assigneeId: 'stub-caseworker-1',
        // The controller resolves the snapshot name from the assignable
        // users directory (stub-auth users) so the backend gets a
        // canonical name even when the form omitted it.
        assigneeName: 'Stub Caseworker One',
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
      payload: 'assigneeId=stub-caseworker-1',
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

  test('POST unassign re-renders the detail page inline when the backend refuses', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    unassignWorkItem.mockResolvedValue({
      ok: false,
      status: statusCodes.conflict,
      problem: {
        detail: 'This work item cannot be unassigned in its current state.'
      }
    })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/unassign`
    })

    expect(statusCode).toBe(statusCodes.conflict)
    expect(result).toEqual(
      expect.stringContaining('Could not unassign work item')
    )
    expect(result).toEqual(
      expect.stringContaining(
        'This work item cannot be unassigned in its current state.'
      )
    )
  })

  test('Summary page shows the read-only progress count and link to the tasks page (RA-129)', async () => {
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

  test('Links to the Application history tab rather than rendering audit entries inline', async () => {
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
    // RA-295: the audit log is reached via the "Application history" tab.
    expect(result).toEqual(
      expect.stringContaining('data-testid="tab-application-history"')
    )
    expect(result).toEqual(expect.stringContaining('Application history'))
    expect(result).toEqual(
      expect.stringContaining(`/work-items/${ID}/audit-log`)
    )
    // Entries are rendered on the dedicated page, not inline on the detail
    // view.
    expect(result).not.toEqual(expect.stringContaining('Task completed'))
  })

  // RA-295 AC03 / RA-323: every caseworker has the same permissions, so the
  // reassign / unassign / due-date affordances are offered in the assignment
  // panel in EVERY state — the picker itself now lives on the reassign
  // interstitial the panel links to.
  test('AC03: the assignment panel offers reassign, unassign and due-date links in every state', async () => {
    registerReaccreditation()
    for (const stateId of ['submitted', 'awaiting-decision', 'approved']) {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId,
          assignedToId: null,
          assignedToName: null
        })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const panelIdx = result.indexOf('data-testid="case-assignment-panel"')
      expect(panelIdx).toBeGreaterThan(-1)
      const panel = result.slice(
        panelIdx,
        result.indexOf('data-testid="actions-panel"')
      )
      expect(panel).toEqual(
        expect.stringContaining('data-testid="reassign-link"')
      )
      expect(panel).toEqual(
        expect.stringContaining('data-testid="unassign-link"')
      )
      expect(panel).toEqual(
        expect.stringContaining(`href="/work-items/${ID}/assign"`)
      )
      expect(panel).toEqual(
        expect.stringContaining(`href="/work-items/${ID}/unassign"`)
      )
    }
  })

  // RA-335: a read-only support user still sees the reassign/unassign
  // affordances (never hidden), but as inert spans with no href — see
  // action-link/macro.njk. Route-level enforcement (403 on the underlying
  // POST) is covered separately in auth.test.js.
  test('shows reassign/unassign as disabled, hrefless spans for a support user', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ assignedToId: null, assignedToName: null })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`,
      headers: { 'x-test-user-role': 'support-readonly' }
    })

    const panelIdx = result.indexOf('data-testid="case-assignment-panel"')
    const panel = result.slice(
      panelIdx,
      result.indexOf('data-testid="actions-panel"')
    )
    expect(panel).not.toEqual(
      expect.stringContaining(`href="/work-items/${ID}/assign"`)
    )
    expect(panel).not.toEqual(
      expect.stringContaining(`href="/work-items/${ID}/unassign"`)
    )
    expect(panel).toMatch(
      /<span class="govuk-link app-action-link--disabled" aria-disabled="true" data-testid="reassign-link"/
    )
    expect(panel).toMatch(
      /<span class="govuk-link app-action-link--disabled" aria-disabled="true" data-testid="unassign-link"/
    )
  })

  // The due-date links are NOT part of AC03's "available throughout" — that
  // is about assignment. They follow the engine's `sla-extend` projection,
  // because SlaService.ExtendAsync has no terminal-state check of its own:
  // an ungated link would let a caseworker move the due date on a closed
  // case and the backend would accept it.
  test('due-date links follow the engine projection, not the assignment panel', async () => {
    registerReaccreditation()

    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        availableActions: [
          { actionId: 'sla-extend', displayName: 'Extend SLA' }
        ]
      })
    })
    const live = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })
    expect(live.result).toEqual(
      expect.stringContaining('data-testid="action-sla-extend"')
    )
    expect(live.result).toEqual(
      expect.stringContaining('data-testid="action-sla-override"')
    )

    // Terminal / no SLA action projected: both links must disappear.
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ stateId: 'approved', availableActions: [] })
    })
    const closed = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })
    expect(closed.result).not.toEqual(
      expect.stringContaining('data-testid="action-sla-extend"')
    )
    expect(closed.result).not.toEqual(
      expect.stringContaining('data-testid="action-sla-override"')
    )
    expect(closed.result).not.toEqual(
      expect.stringContaining(`/work-items/${ID}/sla/extend`)
    )
    expect(closed.result).not.toEqual(
      expect.stringContaining(`/work-items/${ID}/sla/override`)
    )
    // ...while assignment stays available, per AC03.
    expect(closed.result).toEqual(
      expect.stringContaining('data-testid="reassign-link"')
    )
    expect(closed.result).toEqual(
      expect.stringContaining('data-testid="unassign-link"')
    )
  })

  // `sla-extend` is filtered out of availableActions rather than skipped in
  // the template, so the length check stays honest: an item whose ONLY
  // action is sla-extend must report "no actions", not render an empty
  // Actions panel.
  test('an item whose only action is sla-extend reports no actions', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        availableActions: [
          { actionId: 'sla-extend', displayName: 'Extend SLA' }
        ]
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).toEqual(
      expect.stringContaining('data-testid="work-item-no-actions"')
    )
    expect(result).not.toEqual(
      expect.stringContaining('data-testid="work-item-actions"')
    )
    // The affordance itself still renders, in the assignment panel.
    expect(result).toEqual(
      expect.stringContaining('data-testid="action-sla-extend"')
    )
  })

  describe('POST /work-items/{id}/self-assign (RA-153)', () => {
    test('RA-295: shows "Assign to yourself and start" on an unassigned work item', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ assignedToId: null, assignedToName: null })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(expect.stringContaining('self-assign-submit'))
      expect(result).toEqual(
        expect.stringContaining('Assign to yourself and start')
      )
      expect(result).toEqual(
        expect.stringContaining(`action="/work-items/${ID}/self-assign"`)
      )
    })

    // RA-295 AC03: assignment must stay available all the way through, so
    // the button is still offered when the item belongs to a COLLEAGUE
    // (taking it over) — it is suppressed only when the caller already holds
    // it, where it would be a no-op.
    test('RA-295: offers self-assign when the item is assigned to someone else, and not when it is already yours', async () => {
      registerReaccreditation()

      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          assignedToId: 'someone-else',
          assignedToName: 'Someone Else'
        })
      })
      const other = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })
      expect(other.statusCode).toBe(statusCodes.ok)
      expect(other.result).toEqual(
        expect.stringContaining('self-assign-submit')
      )
      expect(other.result).toEqual(
        expect.stringContaining('Assigned to Someone Else')
      )

      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          assignedToId: TEST_STANDARD_USER.id,
          assignedToName: 'Test Caseworker'
        })
      })
      const mine = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })
      expect(mine.statusCode).toBe(statusCodes.ok)
      expect(mine.result).not.toEqual(
        expect.stringContaining('self-assign-submit')
      )
      expect(mine.result).toEqual(expect.stringContaining('Assigned to you'))
    })

    test('Caseworker self-assigns and is redirected to the detail page', async () => {
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
          'content-type': 'application/x-www-form-urlencoded'
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

  // RA-358 AC1. A withdrawn work item is never deleted by management-be, so
  // its detail page renders a normal 200 — the page itself has to say the
  // application was withdrawn, in application terms and named by its human
  // reference, not by the work-item Guid.
  describe('RA-358 withdrawn application notice', () => {
    function registerWithWithdrawn() {
      registerWorkItemType({
        id: 're-accreditation',
        displayName: 'Re-accreditation',
        initialState: { id: 'submitted', displayName: 'Submitted' },
        states: [
          { id: 'submitted', displayName: 'Submitted' },
          { id: 'withdrawn', displayName: 'Withdrawn', isTerminal: true }
        ],
        getTasksForState: () => []
      })
    }

    test('renders the notice, named by the application reference', async () => {
      registerWithWithdrawn()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId: 'withdrawn' })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('data-testid="work-item-withdrawn-notice"')
      )
      expect(result).toEqual(
        expect.stringContaining('This application has been withdrawn')
      )
      expect(result).toEqual(
        expect.stringContaining('data-testid="work-item-withdrawn-reference"')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'has been withdrawn. It can no longer be progressed and no further action is needed.'
        )
      )
      expect(withdrawnNotice(result)).toContain('RA-000000001')
      // RA-249: the Guid must not be the identifier inside the notice.
      expect(withdrawnNotice(result)).not.toContain(ID)
    })

    test('degrades to unqualified copy when there is no application reference', async () => {
      registerWithWithdrawn()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'withdrawn',
          payload: { applicantName: 'Acme' }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const notice = withdrawnNotice(result)
      expect(notice).toContain(
        'This application has been withdrawn. It can no longer be progressed'
      )
      expect(notice).not.toContain(ID)
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="work-item-withdrawn-reference"')
      )
    })

    test.each(['submitted', 'approved'])(
      'does not render the notice for a %s work item',
      async (stateId) => {
        registerWithWithdrawn()
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: aWorkItem({ stateId })
        })

        const { result } = await server.inject({
          method: 'GET',
          url: `/work-items/${ID}`
        })

        expect(result).not.toEqual(
          expect.stringContaining('data-testid="work-item-withdrawn-notice"')
        )
      }
    )

    // RA-358 security regression. govuk-frontend renders an error-summary
    // item's `html` through `| safe`, so the notice sits on an autoescape
    // bypass. The reference is backend-controlled and this codebase
    // deliberately does not constrain its format, so the ONLY thing standing
    // between it and stored XSS is the template composing the sentence in a
    // `{% set %}` block capture rather than concatenating an HTML string.
    // Without this test, replacing that construct with a hand-built string
    // (or dropping an `| escape`) would go green.
    test('escapes a hostile application reference', async () => {
      registerWithWithdrawn()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'withdrawn',
          payload: {
            applicationReference: '<script>alert(1)</script>'
          }
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      const notice = withdrawnNotice(result)
      // The payload is present but inert.
      expect(notice).toContain('&lt;script&gt;')
      expect(notice).not.toContain('<script>')
      // And nothing leaked a live tag into the page at large.
      expect(result).not.toContain('<script>alert(1)</script>')
    })

    test('does not regress the Outcome panel or the state badge', async () => {
      registerWithWithdrawn()
      registerDetailTemplate(
        're-accreditation',
        'v1',
        're-accreditation/detail-v1'
      )
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId: 'withdrawn' })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(result).toEqual(
        expect.stringContaining('data-testid="work-item-withdrawn-notice"')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'data-testid="re-accreditation-readonly-actions"'
        )
      )
      expect(result).toEqual(
        expect.stringContaining('data-testid="re-accreditation-state-tag"')
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

    test('RA-177: renders the issued confirmation panel and metadata above the application details', async () => {
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
      const summaryIndex = result.indexOf('data-testid="application-details"')
      expect(panelIndex).toBeGreaterThan(-1)
      expect(metadataIndex).toBeGreaterThan(-1)
      expect(summaryIndex).toBeGreaterThan(-1)
      // Success message first, then its metadata, then the application data.
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

    // RA-323: every caseworker has the same permissions, so the Approve
    // CTA's visibility depends only on the work item's state — not on the
    // caller's role or whether they are the assignee.
    test('renders the Approve CTA for any caseworker when item is in awaiting-decision state', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'awaiting-decision',
          assignedToId: 'someone-else',
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
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('data-testid="action-approve"')
      )
      expect(result).toEqual(
        expect.stringContaining('data-testid="re-accreditation-approve-cta"')
      )
      // The Approve CTA is a govukButton styled as a link (href-based),
      // not a plain <a> — it must carry the same role/data-module/
      // draggable attributes govuk-frontend's own button template adds
      // for an href-based button, or keyboard (space-bar activation) and
      // screen-reader support regress for every caseworker, not just a
      // read-only support user. See action-link/macro.njk's `variant:
      // 'button'` path.
      expect(result).toMatch(
        /<a(?=[^>]*data-testid="action-approve")(?=[^>]*role="button")(?=[^>]*draggable="false")(?=[^>]*data-module="govuk-button")[^>]*>/
      )
    })

    // RA-335: a read-only support user still gets a govuk-button-shaped
    // inert span (the "govuk-button" class must survive into the
    // disabled state too — see action-link/macro.njk's disabled branch
    // for variant: 'button'), not a plain link-shaped one.
    test('renders the Approve CTA as a disabled govuk-button-shaped span for a support user', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'awaiting-decision',
          assignedToId: 'someone-else',
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

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`,
        headers: { 'x-test-user-role': 'support-readonly' }
      })

      expect(result).toMatch(
        /<span(?=[^>]*data-testid="action-approve")(?=[^>]*class="govuk-button[^"]*app-action-link--disabled)/
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
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-approve"')
      )
    })
  })

  // RA-249 (was RA-196): when applicationReference is missing, the
  // NAVIGATIONAL label (page title / caption / breadcrumb leaf) still falls
  // back to the work-item id — an identifier is legitimately useful there.
  test('RA-249: Navigational label falls back to the work item id when applicationReference is missing', async () => {
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
    // Page title falls back to the ID as a navigational identifier.
    expect(result).toEqual(expect.stringContaining(`Work item ${ID}`))
    // RA-295: so does the case header's breadcrumb leaf, which replaced the
    // GOV.UK breadcrumbs on this page.
    expect(result).toMatch(
      new RegExp(`data-testid="case-header-accreditation-ref">${ID}<`)
    )
  })

  // RA-249: a field LABELLED "Application reference" must show the human RA-*
  // reference or NOTHING — never the work-item Guid. RA-295 moved that row
  // into the reference block at the bottom of the page, which omits absent
  // values rather than rendering them, so the row must not appear at all.
  test('RA-249: the Application reference row is absent (never the id) when applicationReference is missing', async () => {
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
    expect(result).not.toMatch(
      /data-testid="work-item-reference-row-application-reference"/
    )
    // The id is still available for debugging, under its own honest label.
    expect(result).toMatch(/data-testid="work-item-reference-row-work-item-id"/)
  })

  // RA-249: when applicationReference IS present, the reference row shows it
  // (and not the id).
  test('RA-249: the Application reference row shows the reference when present', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicantName: 'Acme',
          applicationReference: 'RA-987654321'
        }
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    const match = result.match(
      /data-testid="work-item-reference-row-application-reference">[\s\S]*?<dd class="govuk-summary-list__value">([\s\S]*?)<\/dd>/
    )
    expect(match).not.toBeNull()
    expect(match[1].trim()).toBe('RA-987654321')
  })

  // RA-295: the retained reference block is at the BOTTOM — after the
  // application details — per the Jira note.
  test('RA-295: the retained application reference renders after the application details', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {
          applicantName: 'Acme',
          applicationReference: 'RA-987654321'
        }
      })
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    const detailsIdx = result.indexOf('data-testid="application-details"')
    const footerIdx = result.indexOf(
      'data-testid="work-item-application-ref-footer"'
    )
    expect(detailsIdx).toBeGreaterThan(-1)
    expect(footerIdx).toBeGreaterThan(detailsIdx)
  })
})

// ---------------------------------------------------------------------
// RA-295. The individual work item page realigned to the case-management
// prototype: case header (AC01), all submitted application data on one
// page in the AC02 order, assignment panel (AC03), responsive two-column
// body (AC05), and the retained-but-demoted reference block.
// ---------------------------------------------------------------------
describe('RA-295 individual work item page', () => {
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
    getReAccreditationPriorYear.mockReset()
    getReAccreditationPriorYear.mockResolvedValue({ ok: false })
    clearWorkItemRegistry()
    clearDetailTemplateRegistry()
    // Register the REAL module type so the case header's Status resolves
    // through the same state display names the Applications list uses,
    // rather than a hand-rolled fixture that could drift from it.
    registerWorkItemType(reAccreditationType)
  })

  // `payload` is destructured OUT of the rest so the trailing `...overrides`
  // cannot clobber the merged payload — it previously did, which silently
  // reduced every `fullPayloadWorkItem({ payload: … })` call to a work item
  // carrying ONLY the override's keys. That mattered most for the exporter
  // BES/ORS test, which was proving those rows render in isolation rather
  // than alongside the rest of a real submission. Payload merging is now
  // structurally guaranteed by ordering, not by convention.
  function fullPayloadWorkItem({
    payload: payloadOverrides,
    ...overrides
  } = {}) {
    return aWorkItem({
      stateId: 'duly-made',
      slaDueDate: '2026-08-24T09:00:00Z',
      assignedToId: null,
      assignedToName: null,
      availableActions: [],
      ...overrides,
      payload: {
        applicationReference: 'RA-2026-00001',
        organisationName: 'GreenLoop Recovery',
        operatorOrganisationId: 'ORG-123-001',
        registrationNumber: 'EPR-100999',
        material: 'plastic',
        siteAddress: '2 Wyld Court, Addingrove, AA3 1AA',
        prns: {
          plannedTonnageBand: 'UpTo1000',
          authorisers: [{ fullName: 'Harry Edge', email: 'harry@example.com' }]
        },
        samplingPlan: {
          files: [
            {
              fileId: 'f-1',
              filename: 'sampling-plan.pdf',
              scanStatus: 'Clean',
              uploadedAt: '2026-06-01T10:00:00Z'
            },
            {
              fileId: 'f-2',
              filename: 'inspection-addendum.pdf',
              scanStatus: 'Clean',
              uploadedAt: '2026-06-02T10:00:00Z'
            }
          ]
        },
        businessPlan: {
          newInfrastructurePercent: 80,
          newInfrastructureDetail: 'Sorting line investment'
        },
        ...(payloadOverrides ?? {})
      }
    })
  }

  // AC01 -------------------------------------------------------------
  test('AC01: renders the case header with all eight pieces of information', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    const headerIdx = result.indexOf('data-testid="case-header"')
    expect(headerIdx).toBeGreaterThan(-1)
    // Scope every field assertion to the header, so a value that also
    // appears in the body below (e.g. "Plastic") cannot make it pass.
    const header = result.slice(headerIdx, result.indexOf('</dl>', headerIdx))

    expect(header).toContain('data-testid="case-header-applications-link"')
    expect(header).toContain('href="/work-items"')
    expect(header).toContain('Applications')
    expect(header).toMatch(/case-header-accreditation-ref">RA-2026-00001</)
    expect(header).toMatch(/case-header-org-name">GreenLoop Recovery</)
    expect(header).toMatch(/case-header-org-id">ORG-123-001</)
    expect(header).toContain('data-testid="case-header-material"')
    expect(header).toContain('Plastic')
    expect(header).toContain('data-testid="case-header-status"')
    expect(header).toContain('Duly made')
    expect(header).toContain('data-testid="case-header-assigned-to"')
    expect(header).toContain('Unassigned')
    expect(header).toContain('data-testid="case-header-due-on"')
    expect(header).toContain('24 August 2026')
    expect(header).toContain('data-testid="case-header-registration-number"')
    expect(header).toContain('EPR-100999')
  })

  test('AC01: the case header due date is an em dash when no SLA clock has started', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({ slaDueDate: null })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).toMatch(/data-testid="case-header-due-on">\s*—\s*</)
  })

  test('AC01: the RA-98 reference-implementation notification banner is gone', async () => {
    registerDetailTemplate(
      're-accreditation',
      'v1',
      're-accreditation/detail-v1'
    )
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).toEqual(
      expect.stringContaining('data-testid="re-accreditation-detail"')
    )
    expect(result).not.toEqual(
      expect.stringContaining(
        'Reference implementation showing how a module supplies its own detail template'
      )
    )
  })

  // AC02 -------------------------------------------------------------
  test('AC02: renders every application field on ONE page, in the AC02 order', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('data-testid="application-details"')
    )

    const order = [
      'site-address',
      'type',
      'material',
      'prn-tonnage',
      'prn-authorisers',
      'authority-to-issue',
      'sampling-inspection-plan',
      'business-plan'
    ].map((key) => result.indexOf(`data-testid="app-detail-row-${key}"`))

    expect(order.every((idx) => idx > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))

    // The actual submitted values render, not just the labels.
    expect(result).toContain('2 Wyld Court, Addingrove, AA3 1AA')
    expect(result).toContain('Up to 1,000 tonnes')
    expect(result).toContain('Harry Edge')
    expect(result).toContain('harry@example.com')
    expect(result).toContain('Sorting line investment')
    expect(result).toContain('80% of PRN income')
  })

  test('AC02: lists EVERY supporting document, with the S&I updated-by metadata', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    const row = detailRow(result, 'sampling-inspection-plan')
    expect(result.match(/data-testid="app-detail-document"/g)).toHaveLength(2)
    expect(result).toContain('sampling-plan.pdf')
    expect(result).toContain('inspection-addendum.pdf')
    expect(result).toContain(`/work-items/${ID}/files/f-1/download`)
    expect(result).toContain(`/work-items/${ID}/files/f-2/download`)
    expect(row).toContain('data-testid="app-detail-sampling-updated-by"')
    expect(result).toContain('Updated 1 June 2026 at 11:00am')
  })

  test('AC02: a file that has not passed the virus scan is listed but not linked', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        payload: {
          samplingPlan: {
            files: [
              {
                fileId: 'f-9',
                filename: 'quarantined.pdf',
                scanStatus: 'Infected'
              }
            ]
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).toContain('quarantined.pdf')
    expect(result).not.toContain('/files/f-9/download')
    expect(result).toContain('govuk-tag--red')
  })

  test('AC02: says so when no supporting documents were uploaded', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({ payload: { samplingPlan: null } })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).toContain('data-testid="app-detail-documents-none"')
  })

  test('AC02: renders an em dash for empty multi-value and business-plan rows', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        payload: {
          siteAddress: null,
          prns: null,
          businessPlan: null,
          samplingPlan: null
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(detailRow(result, 'site-address')).toContain('—')
    expect(detailRow(result, 'prn-authorisers')).toContain('—')
    expect(detailRow(result, 'business-plan')).toContain('—')
  })

  test('AC02: hides BES and ORS entirely for a reprocessor', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).not.toContain('data-testid="app-detail-row-bes"')
    expect(result).not.toContain('data-testid="app-detail-row-ors"')
    expect(result).not.toContain('Broadly Equivalent Standards')
    expect(result).not.toContain('Overseas Reprocessing Site')
    // ...and the Type row names the applicant kind.
    // ...and the Type row states only the registry display name — it must
    // NOT claim an applicant kind the backend never sends.
    expect(detailRow(result, 'type')).toContain('Re-accreditation')
    expect(detailRow(result, 'type')).not.toContain('Reprocessor')
  })

  test('AC02: shows BES then ORS, last and in that order, for an exporter', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        payload: {
          overseasSites: {
            sites: [
              {
                siteName: 'Rotterdam Reprocessing',
                country: 'Netherlands',
                siteAddress: '1 Overseas Lane, Rotterdam',
                besEvidence: {
                  files: [
                    {
                      fileId: 'b-1',
                      filename: 'bes-evidence.pdf',
                      scanStatus: 'Clean'
                    }
                  ]
                }
              }
            ]
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    const besIdx = result.indexOf('data-testid="app-detail-row-bes"')
    const orsIdx = result.indexOf('data-testid="app-detail-row-ors"')
    const planIdx = result.indexOf('data-testid="app-detail-row-business-plan"')
    expect(planIdx).toBeLessThan(besIdx)
    expect(besIdx).toBeLessThan(orsIdx)

    expect(result).toContain('Broadly Equivalent Standards (BES)')
    expect(result).toContain('Overseas Reprocessing Site (ORS)')
    expect(result).toContain('bes-evidence.pdf')
    expect(result).toContain(`/work-items/${ID}/files/b-1/download`)
    expect(detailRow(result, 'ors')).toContain(
      'data-testid="overseas-site-address"'
    )
    expect(result).toContain('1 Overseas Lane, Rotterdam')
    // Even on an exporter the Type row must not claim "Exporter": the
    // overseasSites signal gates the BES/ORS SECTIONS, it is not evidence of
    // an applicant type. Positive assertion first, so the negative below is
    // scoped to a row that demonstrably exists.
    expect(detailRow(result, 'type')).toContain('Re-accreditation')
    expect(detailRow(result, 'type')).not.toContain('Exporter')
  })

  test('AC02: an unscanned BES evidence file is named but not linked', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        payload: {
          overseasSites: {
            sites: [
              {
                siteName: 'Rotterdam Reprocessing',
                besEvidence: {
                  files: [
                    {
                      fileId: 'b-9',
                      filename: 'bes.pdf',
                      scanStatus: 'Pending'
                    }
                  ]
                }
              }
            ]
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).toContain('bes.pdf')
    expect(result).not.toContain('/files/b-9/download')
  })

  test('AC02: the "View full application details" link is gone', async () => {
    registerDetailTemplate(
      're-accreditation',
      'v1',
      're-accreditation/detail-v1'
    )
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).not.toContain('data-testid="view-application-details-link"')
    expect(result).not.toContain('View full application details')
  })

  test('AC02: the old two-step page redirects to the detail page', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/application-details`
    })

    // Deliberately a 302, never a 301: a permanent redirect would be cached
    // indefinitely by the browser, stranding anyone who followed the link
    // once if this route ever has to come back or point elsewhere.
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    // The redirect must not need the backend at all.
    expect(getWorkItem).not.toHaveBeenCalled()
  })

  test('RA-254: folds the previous-year reference data into the same page', async () => {
    getReAccreditationPriorYear.mockResolvedValue({
      ok: true,
      priorYear: {
        year: 2025,
        tonnageBand: 'UpTo500',
        authorisers: [
          { fullName: 'Prior Person' },
          { email: 'p@example.com' },
          {}
        ],
        businessPlan: { priceSupportPercent: 40 }
      }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).toContain('data-testid="prior-year-heading"')
    expect(result).toContain('Previous year (2025)')
    expect(result).toContain('Up to 500 tonnes')
    expect(result).toContain('Prior Person')
    expect(result).toContain('p@example.com')
    expect(result).toContain('40% of PRN income')
  })

  test('RA-254: an empty previous year still renders, with em dashes', async () => {
    getReAccreditationPriorYear.mockResolvedValue({
      ok: true,
      priorYear: { year: 2025 }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).toContain('data-testid="prior-year-authorisers"')
    expect(result).toContain('data-testid="prior-year-business-plan"')
    // ...and each empty cell actually shows the em dash, rather than the
    // assertion merely proving the containers exist.
    const cell = (testid) => {
      const start = result.indexOf(`data-testid="${testid}"`)
      return result.slice(start, result.indexOf('</dd>', start))
    }
    expect(cell('prior-year-tonnage')).toContain('—')
    expect(cell('prior-year-authorisers')).toContain('—')
    expect(cell('prior-year-business-plan')).toContain('—')
  })

  // The section is supplementary, so it must never break the page around it.
  // `ok: true` only means the CALL succeeded — a 200 carrying a null or
  // non-object body still satisfies it, and dereferencing that would throw
  // out of the handler and 500 the entire detail page.
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['a number', 42]
  ])(
    'RA-254: a previous-year 200 carrying %s does not break the page',
    async (_label, priorYear) => {
      getReAccreditationPriorYear.mockResolvedValue({ ok: true, priorYear })
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: fullPayloadWorkItem()
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toContain('data-testid="prior-year-heading"')
      // The rest of the page still renders.
      expect(result).toContain('data-testid="application-details"')
    }
  )

  test('RA-254: a failed previous-year lookup omits the section rather than the page', async () => {
    getReAccreditationPriorYear.mockResolvedValue({ ok: false, status: 502 })
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toContain('data-testid="prior-year-heading"')
  })

  test('RA-254: the previous-year lookup is skipped for other work item types', async () => {
    registerWorkItemType({
      id: 'other-type',
      displayName: 'Other',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        typeId: 'other-type',
        stateId: 'submitted'
      })
    })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getReAccreditationPriorYear).not.toHaveBeenCalled()
  })

  // Jira notes -------------------------------------------------------
  test('removes the SLA tracker badge while keeping the due date in the header', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        slaState: 'AtRisk',
        slaRemaining: '2.00:00:00'
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).not.toContain('data-testid="sla-clock-info"')
    expect(result).not.toContain('At risk')
    expect(result).not.toContain('On track')
    expect(result).toContain('data-testid="case-header-due-on"')
  })

  // AC05 -------------------------------------------------------------
  test('AC05: the body uses the responsive two-thirds / one-third grid', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    // GOV.UK grid columns stack full-width below desktop, so the assignment
    // panel reflows rather than clipping.
    expect(result).toContain('govuk-grid-column-two-thirds')
    expect(result).toContain('govuk-grid-column-one-third')
    const panelIdx = result.indexOf('data-testid="case-assignment-panel"')
    const thirdIdx = result.lastIndexOf('govuk-grid-column-one-third', panelIdx)
    expect(thirdIdx).toBeGreaterThan(-1)
  })
})
