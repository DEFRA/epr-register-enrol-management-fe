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
  addWorkItemNote: vi.fn(),
  updateRecyclingOperations: vi.fn()
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
      { id: 'duly-made', displayName: 'Duly made' },
      {
        id: 'assessment-in-progress',
        displayName: 'Assessment in progress'
      },
      { id: 'awaiting-decision', displayName: 'Awaiting decision' },
      { id: 'queried', displayName: 'Queried' },
      { id: 'updated', displayName: 'Updated' },
      { id: 'approved', displayName: 'Approved', isTerminal: true },
      { id: 'rejected', displayName: 'Refused', isTerminal: true },
      { id: 'withdrawn', displayName: 'Withdrawn', isTerminal: true }
    ],
    // RA-410. The synthetic type now has to carry the transitions the new
    // declarative lookups read, because those replaced flags that used to
    // arrive on the wire: `resolveSelfAssignTransition` (the marker behind
    // "Assign to yourself and start"), `isContinueReviewState` (which
    // replaced the removed `taskStateId`-derived waypoint flag) and
    // `evaluateLogDecisionEligibility` all resolve against the registry.
    // A type declaring no transitions would silently answer "no" to all
    // three and every CTA assertion here would pass vacuously.
    transitions: [
      // RA-454. The synthetic type must carry `duly-make` too: both
      // `evaluateDulyMakeEligibility` (behind `canDulyMake`) and the
      // `isPreDulyMadeWaypoint` gate that suppresses Continue review for a
      // query raised before duly making read this declaration's
      // `fromStateId`. Without it the pre-duly-made scenario cannot be
      // exercised and every duly-make assertion here would pass vacuously.
      {
        actionId: 'duly-make',
        displayName: 'Duly make',
        fromStateId: 'submitted',
        toStateId: 'duly-made',
        callerInvocable: false
      },
      {
        actionId: 'payment-received',
        displayName: 'Payment received',
        fromStateId: 'duly-made',
        toStateId: 'assessment-in-progress',
        startsOnSelfAssign: true
      },
      {
        actionId: 'submit-for-decision',
        displayName: 'Submit for decision',
        fromStateId: 'assessment-in-progress',
        toStateId: 'awaiting-decision',
        callerInvocable: false
      },
      {
        actionId: 'approve',
        displayName: 'Approve',
        fromStateId: 'awaiting-decision',
        toStateId: 'approved',
        callerInvocable: false
      },
      {
        actionId: 'reject',
        displayName: 'Reject',
        fromStateId: 'awaiting-decision',
        toStateId: 'rejected',
        callerInvocable: false
      },
      {
        actionId: 'continue-review-during-assessment',
        displayName: 'Continue review',
        fromStateId: 'updated',
        toStateId: 'assessment-in-progress',
        callerInvocable: false
      }
    ]
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

  test('Renders the work item with summary and a link to the audit log', async () => {
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
    // RA-410. The tasks page and the progress summary that linked to it are
    // gone. Assert the absence rather than dropping the check — a stray link
    // to a now-404 route is exactly the regression AC01/AC03 care about.
    expect(result).not.toEqual(
      expect.stringContaining(`/work-items/${ID}/tasks`)
    )
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

  // RA-196: the caption and the final breadcrumb show the user-facing
  // application reference, while the assign/tasks/audit-log routes keep using
  // the internal id.
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
    expect(result).toEqual(expect.stringContaining('RA-987654321'))
    // Internal id must not appear as the caption text but still drives routes.
    expect(result).not.toEqual(expect.stringContaining(`Work item ${ID}`))
    // RA-410. The tasks route is gone; the audit log is the surviving
    // id-driven sub-route this test is really about.
    expect(result).not.toEqual(
      expect.stringContaining(`/work-items/${ID}/tasks`)
    )
    expect(result).toEqual(
      expect.stringContaining(`/work-items/${ID}/audit-log`)
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
    // RA-358 AC2. The breadcrumb must speak the same vocabulary as the
    // heading and the back link, all three of which point at /work-items.
    // Scoped to the breadcrumb class: the header nav also renders a
    // "Work items" link, so a bare substring check would be ambiguous.
    expect(result).toContain(
      '<a class="govuk-breadcrumbs__link" href="/work-items">Applications</a>'
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

  // RA-317. Withdraw is an OPERATOR action. The generic apply-action route
  // must reject a `withdraw`/`withdraw-*` id even though the backend is
  // otherwise authoritative for actions — so a crafted POST that bypasses
  // the removed UI control cannot withdraw a case from Case Management. The
  // backend is never asked; the app renders its "action not available" page.
  test.each(['withdraw', 'withdraw-during-decision', 'withdraw-during-query'])(
    'POST action rejects the %s id without calling the backend',
    async (actionId) => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

      const { statusCode, result } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/actions/${actionId}`
      })

      expect(statusCode).toBe(statusCodes.conflict)
      expect(result).toEqual(
        expect.stringContaining('This action is not available.')
      )
      expect(applyWorkItemAction).not.toHaveBeenCalled()
    }
  )

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
  // panel in every state — the picker itself now lives on the reassign
  // interstitial the panel links to.
  //
  // RA-358 NARROWED THIS to the ACTIVE lifecycle: `approved` was dropped from
  // the list below because a closed case now renders no assignment affordance
  // at all. The remaining states are the point of the test — "every state"
  // was never about terminal ones; it was about not gating on assignment
  // status or role. See the RA-358 describe block for the terminal cases.
  test('AC03: the assignment panel offers reassign, unassign and due-date links in every active state', async () => {
    registerReaccreditation()
    for (const stateId of ['submitted', 'awaiting-decision', 'queried']) {
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
    // RA-358 REVERSED the original tail of this test, which asserted that
    // "assignment stays available, per AC03" on an approved item. A closed
    // case now renders no assignment affordance either, so the SLA links are
    // no longer distinguishable from assignment BY STATE — what still
    // distinguishes them is the mechanism: SLA follows the engine's
    // `sla-extend` projection (see the live half above, where a non-terminal
    // item with the action projected DOES show them), whereas assignment
    // follows the terminal-state gate. The first half of this test is what
    // keeps it meaningful.
    expect(closed.result).not.toEqual(
      expect.stringContaining('data-testid="reassign-link"')
    )
    expect(closed.result).not.toEqual(
      expect.stringContaining('data-testid="unassign-link"')
    )
    expect(closed.result).toEqual(
      expect.stringContaining('data-testid="assignment-closed"')
    )
  })

  // RA-351. The bug: a queried application offered no way to Extend or
  // Override the SLA even though its clock keeps running while it waits for
  // the operator. management-be now projects `sla-extend` into a queried
  // item's `availableActions` (mirrored by the module.js self-loop), so
  // `canChangeDueDate` turns true exactly as it does in assessment and BOTH
  // due-date links render — no queried special-casing in the controller.
  test('renders both SLA links for a queried item projecting sla-extend', async () => {
    registerReaccreditation()

    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        stateId: 'queried',
        availableActions: [
          { actionId: 'sla-extend', displayName: 'Extend SLA' }
        ]
      })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('data-testid="action-sla-extend"')
    )
    expect(result).toEqual(
      expect.stringContaining('data-testid="action-sla-override"')
    )
    expect(result).toEqual(
      expect.stringContaining(`/work-items/${ID}/sla/extend`)
    )
    expect(result).toEqual(
      expect.stringContaining(`/work-items/${ID}/sla/override`)
    )
  })

  // RA-351. The complement: a queried item the backend does NOT project
  // `sla-extend` for (e.g. a stale backend deployed behind this FE) keeps
  // both links hidden. Proves the links follow the backend projection, not
  // a FE-only "queried always shows SLA" override.
  test('hides both SLA links for a queried item with no sla-extend projected', async () => {
    registerReaccreditation()

    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ stateId: 'queried', availableActions: [] })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(result).not.toEqual(
      expect.stringContaining('data-testid="action-sla-extend"')
    )
    expect(result).not.toEqual(
      expect.stringContaining('data-testid="action-sla-override"')
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

  // -------------------------------------------------------------------
  // RA-364. The backend USED TO project transitions the caller may not
  // invoke (`callerInvocable: false`) into `availableActions`, and the
  // detail page rendered one control per entry — four identical "Resume"
  // buttons out of `queried`, four "Continue review" out of `updated`,
  // every one of which the backend's action endpoint rejected on click.
  //
  // DO NOT DELETE THESE TESTS AS DEAD CODE. The fixtures below contain
  // `callerInvocable: false` actions that a CURRENT backend never emits:
  // management-be now filters them at source, so against a patched
  // backend this filter never fires. That is exactly the point. This is
  // the defence-in-depth half of a two-sided fix, and the case it defends
  // is a STALE backend — a frontend deployed ahead of the backend, which
  // is precisely the window in which the four-buttons bug was visible.
  // The backend's own filter cannot protect that window; only this one
  // can. Both halves are deliberately kept.
  //
  // The filter lives in `decorate`, NOT in the template loops, so the
  // empty-state decision sees the same filtered list.
  //
  // The `updated` state is deliberately covered here rather than in the
  // e2e suite: the only transitions INTO it are the four
  // `resume-during-*`, all non-invocable, so no browser journey can reach
  // it. These unit tests are its only coverage.
  // -------------------------------------------------------------------
  describe('RA-364: non-caller-invocable actions are never rendered', () => {
    /**
     * Slice out the actions panel so a count of action controls cannot be
     * inflated by `action-sla-extend` (which lives in the ASSIGNMENT panel)
     * or by anything else on the page. The actions panel is immediately
     * followed by the tasks panel, so that sibling is the end marker.
     *
     * THROWS when the panel is absent, for the same reason `detailRow`
     * does: a count or negative assertion scoped to a missing element
     * passes vacuously.
     */
    function actionsPanel(html) {
      const start = html.indexOf('data-testid="actions-panel"')
      if (start === -1) {
        throw new Error(
          'No actions panel in the rendered page — a scoped assertion against it would pass vacuously.'
        )
      }
      // RA-504. The reference footer that used to bound this slice is gone, so
      // the page's GOV.UK layout footer (the next thing after the right-hand
      // panels) is the boundary now. Keeping a real boundary rather than
      // slicing to the end of the document matters — an unbounded slice would
      // silently widen the assertion to the whole page.
      const end = html.indexOf('<footer class="govuk-template__footer"', start)
      return html.slice(start, end === -1 ? undefined : end)
    }

    /** Every action control rendered inside the actions panel. */
    function actionTestIds(html) {
      return [
        ...actionsPanel(html).matchAll(/data-testid="(action-[^"]+)"/g)
      ].map((m) => m[1])
    }

    function get() {
      return server.inject({ method: 'GET', url: `/work-items/${ID}` })
    }

    const RESUME_ACTIONS = [
      'resume-during-duly-making',
      'resume-during-duly-made',
      'resume-during-assessment',
      'resume-during-decision'
    ].map((actionId) => ({
      actionId,
      displayName: 'Resume',
      fromStateId: 'queried',
      toStateId: 'submitted',
      requiresAllTasksComplete: false,
      callerInvocable: false
    }))

    const CONTINUE_REVIEW_ACTIONS = [
      'continue-review-during-duly-making',
      'continue-review-during-duly-made',
      'continue-review-during-assessment',
      'continue-review-during-decision'
    ].map((actionId) => ({
      actionId,
      displayName: 'Continue review',
      fromStateId: 'updated',
      toStateId: 'submitted',
      requiresAllTasksComplete: false,
      callerInvocable: false
    }))

    const withdrawDuringQuery = {
      actionId: 'withdraw-during-query',
      displayName: 'Withdraw',
      fromStateId: 'queried',
      toStateId: 'withdrawn',
      requiresAllTasksComplete: false
    }

    const withdrawDuringUpdated = {
      actionId: 'withdraw-during-updated',
      displayName: 'Withdraw',
      fromStateId: 'updated',
      toStateId: 'withdrawn',
      requiresAllTasksComplete: false
    }

    // AC3. The reported bug, exactly as screenshotted: a queried
    // re-accreditation showed four green "Resume" buttons over a Withdraw
    // link. The Resume buttons are non-invocable and must not render.
    // RA-317: Withdraw is an operator action and must not render in the Case
    // Management service either, so a queried item whose only actions are
    // Resume + Withdraw
    // renders NO action affordances at all.
    test('a queried item renders no Resume buttons and no Withdraw link', async () => {
      registerWorkItemType(reAccreditationType)
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'queried',
          availableActions: [...RESUME_ACTIONS, withdrawDuringQuery]
        })
      })

      const { result, statusCode } = await get()

      expect(statusCode).toBe(statusCodes.ok)
      expect(actionTestIds(result)).toEqual([])
      expect(actionsPanel(result)).not.toContain('Resume')
      expect(result).not.toContain('action-withdraw-during-query')
      // RA-317 + RA-364. Withdraw is filtered in the controller BEFORE the
      // template's length check, so a state whose only action was withdraw
      // renders the empty-state notice, not an empty `work-item-actions` div.
      expect(result).toContain('data-testid="work-item-no-actions"')
      for (const action of RESUME_ACTIONS) {
        expect(result).not.toContain(action.actionId)
      }
    })

    // AC4. Same defect, different state and label. Unreachable from the
    // browser, so this is the only place it is pinned. RA-317: Withdraw is
    // gone from the Case Management service too, so an updated item whose
    // only actions are Continue review + Withdraw renders NO action
    // affordances.
    test('an updated item renders no Continue review controls and no Withdraw link', async () => {
      registerWorkItemType(reAccreditationType)
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'updated',
          availableActions: [...CONTINUE_REVIEW_ACTIONS, withdrawDuringUpdated]
        })
      })

      const { result, statusCode } = await get()

      expect(statusCode).toBe(statusCodes.ok)
      expect(actionTestIds(result)).toEqual([])
      expect(actionsPanel(result)).not.toContain('Continue review')
      expect(result).not.toContain('action-withdraw-during-updated')
      // RA-317 + RA-364. Same invariant: withdraw is stripped in the
      // controller, so the empty-state notice renders rather than an empty
      // `work-item-actions` container.
      expect(result).toContain('data-testid="work-item-no-actions"')
      for (const action of CONTINUE_REVIEW_ACTIONS) {
        expect(result).not.toContain(action.actionId)
      }
    })

    // AC2. The whole reason the filter is in the controller rather than in
    // the `{% for %}` loops. Filtering inside the loops would leave this
    // item rendering an EMPTY actions panel with no empty-state message.
    test('an item whose actions are ALL non-invocable renders the empty state', async () => {
      registerWorkItemType(reAccreditationType)
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'queried',
          availableActions: RESUME_ACTIONS
        })
      })

      const { result, statusCode } = await get()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('data-testid="work-item-no-actions"')
      expect(result).toContain(
        'No actions are currently available for this work item.'
      )
      expect(result).not.toContain('data-testid="work-item-actions"')
      expect(actionTestIds(result)).toEqual([])
    })

    // Partial filtering: the invocable entries must survive untouched.
    // RA-410. These use NEUTRAL synthetic action ids rather than borrowing
    // real ones like `reject`. This suite tests the generic `callerInvocable`
    // flag; re-accreditation now declares `reject` / `submit-for-decision`
    // non-invocable in `module.js`, so the declaration-side filter would hide
    // them here and the suite would be asserting the wrong mechanism.
    test('a mixed list renders exactly the invocable actions', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          availableActions: [
            {
              actionId: 'hidden-one',
              displayName: 'Hidden',
              callerInvocable: false
            },
            {
              actionId: 'visible-one',
              displayName: 'Visible one',
              callerInvocable: true
            },
            {
              actionId: 'hidden-two',
              displayName: 'Hidden',
              callerInvocable: false
            },
            {
              actionId: 'visible-two',
              displayName: 'Visible two'
            }
          ]
        })
      })

      const { result, statusCode } = await get()

      expect(statusCode).toBe(statusCodes.ok)
      expect(actionTestIds(result)).toEqual([
        'action-visible-one',
        'action-visible-two'
      ])
      expect(result).toContain('data-testid="work-item-actions"')
      expect(result).not.toContain('data-testid="work-item-no-actions"')
    })

    // AC5, both halves. A regression here would blank the actions panel for
    // every older payload and every fixture written before RA-364, so it is
    // asserted as a rendered-control count, not just a substring.
    test.each([
      ['absent', undefined],
      ['true', true]
    ])(
      'renders every action when the flag is %s (nothing is filtered)',
      async (_label, callerInvocable) => {
        registerReaccreditation()
        const flag = callerInvocable === undefined ? {} : { callerInvocable }
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: aWorkItem({
            availableActions: [
              { actionId: 'visible-one', displayName: 'Visible one', ...flag },
              { actionId: 'visible-two', displayName: 'Visible two', ...flag }
            ]
          })
        })

        const { result, statusCode } = await get()

        expect(statusCode).toBe(statusCodes.ok)
        expect(actionTestIds(result)).toEqual([
          'action-visible-one',
          'action-visible-two'
        ])
        expect(result).not.toContain('data-testid="work-item-no-actions"')
      }
    )

    // AC6. The query link special-casing is unchanged: the query link's
    // testid is hardcoded `action-query` regardless of the real action id.
    // RA-317: the withdraw link special-casing is GONE — a queried item
    // renders the Query link but no withdraw affordance, and never links to
    // the (removed) withdraw confirmation interstitial.
    test('keeps the query link special-casing and drops the withdraw link', async () => {
      registerWorkItemType(reAccreditationType)
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'queried',
          availableActions: [
            ...RESUME_ACTIONS,
            {
              actionId: 'query-during-assessment',
              displayName: 'Query',
              callerInvocable: true
            },
            withdrawDuringQuery
          ]
        })
      })

      const { result, statusCode } = await get()

      expect(statusCode).toBe(statusCodes.ok)
      expect(actionTestIds(result)).toEqual(['action-query'])
      expect(result).toContain(`/work-items/${ID}/query`)
      expect(result).not.toContain('action-withdraw-during-query')
      expect(result).not.toContain(
        `/work-items/${ID}/actions/withdraw-during-query/confirm`
      )
    })

    // A non-invocable query action must be filtered too — the special-cased
    // branch reads the same decorated list, so nothing sneaks past. RA-317:
    // withdraw no longer renders, so with query filtered out there are no
    // action affordances left.
    test('filters a non-invocable query action out of the link row', async () => {
      registerWorkItemType(reAccreditationType)
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'queried',
          availableActions: [
            {
              actionId: 'query-during-assessment',
              displayName: 'Query',
              callerInvocable: false
            },
            withdrawDuringQuery
          ]
        })
      })

      const { result } = await get()

      expect(actionTestIds(result)).toEqual([])
      expect(result).not.toContain('data-testid="action-query"')
      expect(result).not.toContain('action-withdraw-during-query')
      // RA-317 + RA-364. Both actions stripped in the controller, so the
      // honest empty-state notice renders rather than an empty container.
      expect(result).toContain('data-testid="work-item-no-actions"')
    })

    // The filter is applied at the SOURCE, so it also covers a
    // type-specific template that overrides the `actionsPanel` block and
    // re-loops over `availableActions` via `super()`.
    test('applies through the re-accreditation detail-v1 template override', async () => {
      registerReaccreditation()
      registerDetailTemplate(
        're-accreditation',
        'v1',
        're-accreditation/detail-v1'
      )
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          availableActions: [
            ...RESUME_ACTIONS,
            { actionId: 'visible-one', displayName: 'Visible one' }
          ]
        })
      })

      const { result, statusCode } = await get()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('data-testid="re-accreditation-detail"')
      expect(actionTestIds(result)).toEqual(['action-visible-one'])
      expect(actionsPanel(result)).not.toContain('Resume')
    })

    // `sla-extend` is caller-invocable, so the due-date affordance is
    // unaffected by the filter — guarding the one place where filtering at
    // the source (rather than only on the rendered list) changes another
    // derived flag.
    test('leaves the caller-invocable sla-extend due-date affordance alone', async () => {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          availableActions: [
            { actionId: 'sla-extend', displayName: 'Extend SLA' },
            {
              actionId: 'hidden',
              displayName: 'Hidden',
              callerInvocable: false
            }
          ]
        })
      })

      const { result } = await get()

      expect(result).toContain('data-testid="action-sla-extend"')
      expect(result).toContain('data-testid="work-item-no-actions"')
    })

    // The filter runs over the SAME defensive non-array fallback the
    // `sla-extend` filter already relied on, so a malformed payload must
    // still render the empty state rather than throw on `.filter`.
    test.each([
      ['missing', undefined],
      ['null', null],
      ['not an array', 'nope']
    ])(
      'renders the empty state when availableActions is %s',
      async (_label, availableActions) => {
        registerReaccreditation()
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: aWorkItem({ availableActions })
        })

        const { result, statusCode } = await get()

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).toContain('data-testid="work-item-no-actions"')
        expect(actionTestIds(result)).toEqual([])
      }
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

  // ---------------------------------------------------------------------
  // RA-523. QA: "when the user does not assign the work item to themselves
  // in the first instance on a duly made work item, and then queries it,
  // then after the query has been responded to, you get into this weird
  // state where it offers for you to start and assign to yourself, but it
  // should already be assigned"; and "if the work item is not duly made,
  // then on duly making an 'updated' ticket will then recreate the same
  // faulty state."
  //
  // The assignment is NOT lost — three rounds of backend investigation
  // proved the data is intact end to end. What QA is looking at is the
  // ASSIGNMENT PANEL offering "Assign to yourself and start" on an item
  // the caller already holds, whose label reads as though it were
  // unassigned.
  //
  // These tests pin the STATE the button appears in, because that is what
  // separates the real diagnosis from a plausible wrong one: both of QA's
  // routes converge on `duly-made`, the one state a `startsOnSelfAssign`
  // transition (`payment-received`) leaves from, which is what makes
  // `selfAssignStartsWork` true and fires the RA-410 recovery clause in
  // `buildAssignmentViewModel` unconditionally for the assignee.
  // ---------------------------------------------------------------------
  describe('RA-523: an item the caller already holds must not offer "Assign to yourself and start"', () => {
    const ME = TEST_STANDARD_USER.id

    function applied(actionId, fromStateId, toStateId, at) {
      return {
        id: `audit-${actionId}`,
        action: 'action-applied',
        details: { actionId, fromStateId, toStateId },
        stateId: toStateId,
        createdAt: at,
        createdBy: ME,
        createdByName: 'Test Caseworker'
      }
    }

    function assigned(at) {
      return {
        id: 'audit-assigned',
        action: 'assigned',
        details: { assigneeId: ME, assigneeName: 'Test Caseworker' },
        createdAt: at,
        createdBy: ME,
        createdByName: 'Test Caseworker'
      }
    }

    const SUBMITTED = {
      id: 'audit-submitted',
      action: 'work-item-submitted',
      details: { stateId: 'submitted' },
      stateId: 'submitted',
      createdAt: '2026-04-27T10:00:00Z',
      createdBy: 'frontend'
    }

    // QA route 1: an UNASSIGNED duly-made item is queried (raising a query
    // self-assigns it — see query.controller.js's AC04 notice), the
    // operator responds, the item resumes into `updated` and Continue
    // review returns it to `duly-made`, still assigned to the caller.
    const ROUTE_1_AUDIT = [
      SUBMITTED,
      applied('duly-make', 'submitted', 'duly-made', '2026-04-27T11:00:00Z'),
      assigned('2026-04-27T12:00:00Z'),
      applied(
        'query-during-duly-made',
        'duly-made',
        'queried',
        '2026-04-27T12:00:01Z'
      ),
      applied(
        'resume-during-duly-made',
        'queried',
        'updated',
        '2026-04-28T09:00:00Z'
      ),
      applied(
        'continue-review-during-duly-made',
        'updated',
        'duly-made',
        '2026-04-28T10:00:00Z'
      )
    ]

    // QA route 2: a NOT-yet-duly-made (`submitted`) item is queried, which
    // likewise self-assigns it; the operator responds, the item resumes
    // into `updated` with `originStateId: 'submitted'` (so RA-454 offers
    // Duly make rather than Continue review), and duly making it lands it
    // in `duly-made` — still assigned to the caller.
    const ROUTE_2_AUDIT = [
      SUBMITTED,
      assigned('2026-04-27T12:00:00Z'),
      applied(
        'query-during-duly-making',
        'submitted',
        'queried',
        '2026-04-27T12:00:01Z'
      ),
      applied(
        'resume-during-duly-making',
        'queried',
        'updated',
        '2026-04-28T09:00:00Z'
      ),
      applied('duly-make', 'updated', 'duly-made', '2026-04-28T10:00:00Z')
    ]

    async function render(workItem) {
      registerReaccreditation()
      getWorkItem.mockResolvedValue({ ok: true, workItem })
      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })
      expect(statusCode).toBe(statusCodes.ok)
      // Positive hook first: asserting only the ABSENCE of the button would
      // pass vacuously if the whole panel stopped rendering.
      expect(result).toContain('data-testid="case-assignment-panel"')
      return result
    }

    test.each([
      ['route 1 — queried from duly-made, then Continue review', ROUTE_1_AUDIT],
      ['route 2 — queried from submitted, then Duly make', ROUTE_2_AUDIT]
    ])('does not offer self-assign after QA %s', async (_label, auditLog) => {
      const result = await render(
        aWorkItem({
          stateId: 'duly-made',
          assignedToId: ME,
          assignedToName: 'Test Caseworker',
          auditLog
        })
      )

      expect(result).toContain('Assigned to you')
      expect(result).not.toContain('data-testid="self-assign-submit"')
      expect(result).not.toContain('Assign to yourself and start')
      // The item genuinely still has to be started, so the START half is
      // offered — under its own name, and posting one action rather than
      // re-running an assignment the caller already holds.
      expect(result).toContain('data-testid="start-work-submit"')
      expect(result).toContain('Payment received')
      expect(result).toContain(
        `action="/work-items/${ID}/actions/payment-received"`
      )
    })

    // The state the button appears in is load-bearing for the diagnosis.
    // In `updated` there IS no `startsOnSelfAssign` transition, so the
    // clause cannot fire there — if this test ever fails, the cause is
    // something other than `selfAssignStartsWork`.
    test('an assigned item sitting in `updated` never offered it in the first place', async () => {
      const result = await render(
        aWorkItem({
          stateId: 'updated',
          originStateId: 'duly-made',
          assignedToId: ME,
          assignedToName: 'Test Caseworker',
          auditLog: ROUTE_1_AUDIT.slice(0, -1)
        })
      )

      expect(result).toContain('Assigned to you')
      expect(result).not.toContain('data-testid="self-assign-submit"')
    })

    // The gate must stay a gate on the CALLER, not on the state: an
    // unassigned duly-made item, and one held by a colleague, both still
    // offer the button.
    test.each([
      ['unassigned', { assignedToId: null, assignedToName: null }],
      [
        'assigned to a colleague',
        { assignedToId: 'someone-else', assignedToName: 'Someone Else' }
      ]
    ])(
      'still offers self-assign on a duly-made item that is %s',
      async (_l, who) => {
        const result = await render(
          aWorkItem({ stateId: 'duly-made', auditLog: ROUTE_1_AUDIT, ...who })
        )

        expect(result).toContain('data-testid="self-assign-submit"')
        expect(result).toContain('Assign to yourself and start')
        // …and only the assign-and-start button. The start control is for a
        // caller who already holds the item; offering both would put two
        // primary buttons in the panel.
        expect(result).not.toContain('data-testid="start-work-submit"')
      }
    )

    // ------------------------------------------------------------------
    // The RA-410 case the deleted `|| selfAssignStartsWork` clause existed
    // for. "Assign to yourself and start" is two operations; if the assign
    // lands and the transition does not, `callerIsAssignee` flips true and
    // the caller must STILL have a way to start the work. A fix for RA-523
    // that reintroduces the stranded caller is not a fix.
    // ------------------------------------------------------------------
    test('RA-410: a caller stranded by a failed start transition is left with a working start control', async () => {
      registerReaccreditation()
      // The pre-read the handler does BEFORE assigning still sees the item
      // unassigned; every later read (including the in-place re-render) sees
      // the assignment that landed.
      getWorkItem.mockResolvedValueOnce({
        ok: true,
        workItem: aWorkItem({
          stateId: 'duly-made',
          assignedToId: null,
          assignedToName: null
        })
      })
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'duly-made',
          assignedToId: ME,
          assignedToName: 'Test Caseworker'
        })
      })
      assignWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId: 'duly-made', assignedToId: ME })
      })
      // The start half fails — the whole point of the scenario.
      applyWorkItemAction.mockResolvedValue({
        ok: false,
        reason: 'conflict',
        status: statusCodes.conflict,
        message: 'Transition not allowed'
      })

      const { statusCode, result } = await injectWithCrumb(server, {
        method: 'POST',
        url: `/work-items/${ID}/self-assign`,
        payload: {}
      })

      // Rendered in place (not redirected) and carrying the failure's own
      // status, so the caller lands on the item they now hold.
      expect(statusCode).toBe(statusCodes.conflict)
      expect(applyWorkItemAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'payment-received' })
      )
      // The banner must name a control that is actually on the page. It used
      // to say "Select 'Assign to yourself and start' again" — a button that
      // is now (correctly) gone, because the assign half succeeded.
      expect(result).toContain(
        'This application has been assigned to you, but it could not be started.'
      )
      expect(result).toContain(
        'Select &quot;Payment received&quot; to try again.'
      )
      expect(result).not.toContain('Assign to yourself and start')
      // …and the control it names is reachable, so the retry is not a
      // dead end.
      expect(result).toContain('data-testid="start-work-submit"')
      expect(result).toContain(
        `action="/work-items/${ID}/actions/payment-received"`
      )
    })

    // The RA-358 closed-case gate still wins: a terminal item offers no
    // assignment affordance at all, start control included.
    test('offers no start control on a closed case', async () => {
      const result = await render(
        aWorkItem({
          stateId: 'withdrawn',
          assignedToId: ME,
          assignedToName: 'Test Caseworker'
        })
      )

      expect(result).toContain('data-testid="assignment-closed"')
      expect(result).not.toContain('data-testid="start-work-submit"')
      expect(result).not.toContain('data-testid="self-assign-submit"')
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

    // The three assertions above are all substring checks, so a spacing
    // regression in the template's block capture — a missing space before
    // `<strong>`, a doubled one after `</strong>` — satisfies every one of
    // them while rendering "ApplicationRA-000000001has been withdrawn."
    // The whitespace in that capture is part of the sentence, not
    // indentation, so pin the composed result as ONE exact string. This is
    // also what makes the trim markers in the template safe to touch: any
    // change to them shows up here immediately.
    test('composes the referenced sentence with exact spacing', async () => {
      registerWithWithdrawn()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId: 'withdrawn' })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(withdrawnNotice(result)).toContain(
        'Application <strong data-testid="work-item-withdrawn-reference">RA-000000001</strong> has been withdrawn. It can no longer be progressed and no further action is needed.'
      )
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

  // RA-358. Tom's decision: no assignment affordance renders on a closed
  // case. This NARROWS RA-295 AC03 ("assignment available all the way
  // through") to the active lifecycle — see buildAssignmentViewModel for the
  // hand-over rationale that was traded away.
  describe('RA-358 assignment gate on terminal states', () => {
    const AFFORDANCES = ['self-assign-submit', 'reassign-link', 'unassign-link']

    function registerWithTerminalStates() {
      registerWorkItemType({
        id: 're-accreditation',
        displayName: 'Re-accreditation',
        initialState: { id: 'submitted', displayName: 'Submitted' },
        states: [
          { id: 'submitted', displayName: 'Submitted' },
          { id: 'approved', displayName: 'Approved', isTerminal: true },
          { id: 'rejected', displayName: 'Rejected', isTerminal: true },
          { id: 'withdrawn', displayName: 'Withdrawn', isTerminal: true }
        ],
        getTasksForState: () => []
      })
    }

    async function renderInState(stateId) {
      registerWithTerminalStates()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId })
      })
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })
      expect(statusCode).toBe(statusCodes.ok)
      return result
    }

    test.each(['withdrawn', 'approved', 'rejected'])(
      'suppresses every assignment affordance in the %s state',
      async (stateId) => {
        const result = await renderInState(stateId)

        // Positive hook FIRST. Asserting only the absence of the three
        // affordances would pass vacuously if the panel stopped rendering
        // altogether, so anchor on something that must be present.
        expect(result).toContain('data-testid="case-assignment-panel"')
        expect(result).toContain('data-testid="assignment-closed"')
        expect(result).toContain(
          'This application is closed. It cannot be assigned or reassigned.'
        )

        for (const testId of AFFORDANCES) {
          expect(result).not.toContain(`data-testid="${testId}"`)
        }
        // Suppressed outright, not rendered as an RA-335 inert span.
        expect(result).not.toContain('app-action-link--disabled')
        // The self-assign form must not survive the button.
        expect(result).not.toContain(`/work-items/${ID}/self-assign`)
      }
    )

    test('still offers every assignment affordance in a non-terminal state', async () => {
      const result = await renderInState('submitted')

      expect(result).toContain('data-testid="case-assignment-panel"')
      expect(result).not.toContain('data-testid="assignment-closed"')
      for (const testId of AFFORDANCES) {
        expect(result).toContain(`data-testid="${testId}"`)
      }
      expect(result).toContain(`/work-items/${ID}/self-assign`)
    })

    // The gate hides the whole links list, which the SLA affordances share.
    // Called out explicitly because it is a deliberate side effect: the
    // existing canChangeDueDate comment already says moving a due date on a
    // closed case is wrong.
    test('also suppresses the SLA links on a closed case', async () => {
      registerWithTerminalStates()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'withdrawn',
          availableActions: [{ actionId: 'sla-extend', displayName: 'Extend' }]
        })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(result).toContain('data-testid="assignment-closed"')
      expect(result).not.toContain('data-testid="action-sla-extend"')
      expect(result).not.toContain('data-testid="action-sla-override"')
    })

    // The assignee is information, not an affordance: a handed-over case
    // should still show who holds it after it closes.
    test('still shows the current assignee on a closed case', async () => {
      registerWithTerminalStates()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'withdrawn',
          assignedToId: 'user-1',
          assignedToName: 'Casey Worker'
        })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(result).toContain('data-testid="assignment-current"')
      expect(result).toContain('Casey Worker')
      expect(result).toContain('data-testid="assignment-closed"')
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

  // RA-346 x RA-358. Merging `main` into this branch brought two rules into
  // the same neighbourhood of `renderDetail`, and BOTH decide which
  // affordances render: RA-358's closed-case assignment gate
  // (`buildAssignmentViewModel`, keyed off the DECORATED item's `stateId`)
  // and RA-346's approve gate (`applyReAccreditationViewModel`, keyed off
  // the RAW backend DTO via `source`). Each is covered on its own above.
  // What is pinned here is that the two COMPOSE — a merge that compiles and
  // leaves both suites green is not by itself evidence of that, because
  // neither suite exercises the pair in a single render.
  describe('RA-346 x RA-358: the approve gate and the closed-case gate compose', () => {
    const AFFORDANCES = ['self-assign-submit', 'reassign-link', 'unassign-link']

    // The single `awaiting-decision` task, COMPLETE — so that in every test
    // below nothing but the STATE can decide the approve gate's answer.
    const decisionTasksComplete = [
      {
        taskId: 'record-decision-rationale',
        displayName: 'Record decision rationale',
        status: 'Completed'
      }
    ]

    // The backend always projects `withdraw-during-decision` in
    // `awaiting-decision` (it carries no task-completion requirement). The
    // fixture has to carry it: detail.njk nests the `approveAction` block
    // INSIDE `{% if workItem.availableActions.length > 0 %}`, so an
    // otherwise-actionless item would hide the CTA for a reason that has
    // nothing to do with the RA-346 gate under test here.
    const withdrawDuringDecision = [
      {
        actionId: 'withdraw-during-decision',
        displayName: 'Withdraw',
        fromStateId: 'awaiting-decision',
        toStateId: 'withdrawn',
        requiresAllTasksComplete: false
      }
    ]

    // The REAL module + its real detail template. RA-358's own block above
    // registers a trimmed-down stub that declares NO transitions, so it
    // cannot show either gate still holding against the shipped declaration.
    function renderReal(workItem) {
      registerWorkItemType(reAccreditationType)
      registerDetailTemplate(
        're-accreditation',
        'v1',
        're-accreditation/detail-v1'
      )
      getWorkItem.mockResolvedValue({ ok: true, workItem })
      return server.inject({ method: 'GET', url: `/work-items/${ID}` })
    }

    // Both rules in their PERMISSIVE direction, in one render. This is the
    // half that catches one gate over-reaching into the other's territory:
    // an approve gate that also suppressed assignment, or a closed-case gate
    // that mistook an active `awaiting-decision` item for a closed one.
    test('an active awaiting-decision case offers BOTH the Approve CTA and every assignment affordance', async () => {
      const { result, statusCode } = await renderReal(
        aWorkItem({
          stateId: 'awaiting-decision',
          tasks: decisionTasksComplete,
          availableActions: withdrawDuringDecision
        })
      )

      expect(statusCode).toBe(statusCodes.ok)
      // RA-346 half: the gate read the RAW DTO, found a complete task set
      // and a declared `approve` transition out of `awaiting-decision`.
      expect(result).toContain('data-testid="log-decision-cta"')
      // RA-358 half: not terminal, so nothing is suppressed.
      expect(result).toContain('data-testid="case-assignment-panel"')
      expect(result).not.toContain('data-testid="assignment-closed"')
      for (const testId of AFFORDANCES) {
        expect(result).toContain(`data-testid="${testId}"`)
      }
    })

    // Driving the state list off the module declaration (rather than
    // repeating a literal) also pins the invariant the merge resolution
    // leans on: `TERMINAL_STATE_IDS` in detail.controller.js is a hardcoded
    // list (epr-uf42 tracks deriving it from `states[].isTerminal`). If the
    // module ever declares a terminal state that list does not know about,
    // the closed-case gate silently stops firing for it and this fails.
    const declaredTerminalStates = reAccreditationType.states
      .filter((state) => state.isTerminal)
      .map((state) => state.id)

    test('the module still declares the terminal states this block relies on', () => {
      // `test.each` over an empty array is a silent no-op, so the list the
      // case below iterates has to be pinned or it could pass vacuously.
      expect(declaredTerminalStates).toEqual([
        'approved',
        'rejected',
        'withdrawn'
      ])
    })

    test.each(declaredTerminalStates)(
      'a closed case in the %s state suppresses assignment and offers no approval',
      async (stateId) => {
        const { result, statusCode } = await renderReal(
          aWorkItem({ stateId, tasks: decisionTasksComplete })
        )

        expect(statusCode).toBe(statusCodes.ok)

        // RA-358 half, now against the REAL module declaration. Positive
        // hook first, so the absence assertions cannot pass vacuously.
        expect(result).toContain('data-testid="case-assignment-panel"')
        expect(result).toContain('data-testid="assignment-closed"')
        for (const testId of AFFORDANCES) {
          expect(result).not.toContain(`data-testid="${testId}"`)
        }

        // RA-346 half, recorded honestly as belt-and-braces rather than
        // dressed up as proof of the controller gate: on a terminal state
        // detail-v1's `actionsPanel` override does not call `super()`, and
        // `approveAction` is nested INSIDE that block, so the CTA cannot
        // render here whatever `canLogDecision` says. The controller
        // -level proof that a terminal item is refused lives in
        // approve-eligibility.test.js ('blocks approval from a terminal
        // state'). What this pins is the composed OUTCOME the user sees —
        // a closed case never offers approval by either route.
        expect(result).not.toContain('data-testid="log-decision-cta"')
        expect(result).toContain(
          'data-testid="re-accreditation-readonly-actions"'
        )
      }
    )
  })

  describe('RA-410 log-decision CTA eligibility (canLogDecision)', () => {
    // RA-346. Register the REAL module type rather than the trimmed-down
    // stub the other blocks use. The Approve CTA is now gated by the
    // module's DECLARED `approve` transition (`requiresAllTasksComplete:
    // true`), so a fixture type with no transitions would vacuously "pass"
    // this suite while telling us nothing about the shipped declaration.
    function registerReaccreditationWithDetailV1() {
      registerWorkItemType(reAccreditationType)
      registerDetailTemplate(
        're-accreditation',
        'v1',
        're-accreditation/detail-v1'
      )
    }

    // The single `awaiting-decision` task, complete. RA-346's whole point is
    // that the CTA must not render until this is done.
    const decisionTasksComplete = [
      {
        taskId: 'record-decision-rationale',
        displayName: 'Record decision rationale',
        status: 'Completed'
      }
    ]

    const withdrawDuringDecision = [
      // Backend always returns withdraw-during-decision in this state
      // (no task-completion requirement).
      {
        actionId: 'withdraw-during-decision',
        displayName: 'Withdraw',
        fromStateId: 'awaiting-decision',
        toStateId: 'withdrawn',
        requiresAllTasksComplete: false
      }
    ]

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
          tasks: decisionTasksComplete,
          availableActions: withdrawDuringDecision
        })
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('data-testid="log-decision-cta"')
      )
      expect(result).toEqual(
        expect.stringContaining(
          'data-testid="re-accreditation-log-decision-cta"'
        )
      )
      // The Approve CTA is a govukButton styled as a link (href-based),
      // not a plain <a> — it must carry the same role/data-module/
      // draggable attributes govuk-frontend's own button template adds
      // for an href-based button, or keyboard (space-bar activation) and
      // screen-reader support regress for every caseworker, not just a
      // read-only support user. See action-link/macro.njk's `variant:
      // 'button'` path.
      expect(result).toMatch(
        /<a(?=[^>]*data-testid="log-decision-cta")(?=[^>]*role="button")(?=[^>]*draggable="false")(?=[^>]*data-module="govuk-button")[^>]*>/
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
          tasks: decisionTasksComplete,
          availableActions: withdrawDuringDecision
        })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`,
        headers: { 'x-test-user-role': 'support-readonly' }
      })

      expect(result).toMatch(
        /<span(?=[^>]*data-testid="log-decision-cta")(?=[^>]*class="govuk-button[^"]*app-action-link--disabled)/
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
        expect.stringContaining('data-testid="log-decision-cta"')
      )
    })

    // ------------------------------------------------------------------
    // RA-410 supersedes RA-346 AC1 for `submit-for-decision`.
    //
    // RA-346's arrangement was backend-only: `decorate` copied
    // `availableActions` through verbatim, so the page rendered exactly what
    // the backend projected, in both directions. That is no longer the
    // intended behaviour for this action.
    //
    // `submit-for-decision` is declared `callerInvocable: false` in v12
    // because both hops of a decision are applied server-side by the
    // `/decision` endpoint. A button that moved an item to
    // `awaiting-decision` and stopped would strand it, since the Log
    // decision CTA renders from `assessment-in-progress`. So the frontend
    // now suppresses it from its OWN declaration, and — critically — does so
    // even when the backend projects it as invocable, which is exactly what
    // a pre-v12 backend does during the deployment window.
    //
    // The pass-through property RA-346 pinned still holds for every action
    // the declaration does not mark non-invocable; the RA-364 suite above
    // covers that with neutral synthetic ids.
    // ------------------------------------------------------------------
    const assessmentAction = {
      actionId: 'submit-for-decision',
      displayName: 'Submit for decision',
      fromStateId: 'assessment-in-progress',
      toStateId: 'awaiting-decision'
    }

    test.each([
      ['withholds it', []],
      ['projects it', [assessmentAction]],
      [
        'projects it as explicitly caller-invocable (a pre-v12 backend)',
        [{ ...assessmentAction, callerInvocable: true }]
      ]
    ])(
      'never renders submit-for-decision, even when the backend %s',
      async (_label, availableActions) => {
        registerReaccreditationWithDetailV1()
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: aWorkItem({
            stateId: 'assessment-in-progress',
            availableActions
          })
        })

        const { result, statusCode } = await server.inject({
          method: 'GET',
          url: `/work-items/${ID}`
        })

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).not.toEqual(
          expect.stringContaining('data-testid="action-submit-for-decision"')
        )
        // Guards against a vacuous pass: the page really did render, and the
        // Log decision CTA is what stands in that action's place.
        expect(result).toEqual(
          expect.stringContaining('data-testid="log-decision-cta"')
        )
      }
    )
  })

  // RA-410. The stale-backend window. `isCallerInvocable` reads the flag off
  // the PROJECTED action, so a backend that predates v12 — which sends no
  // flag, or sends `true` — would slip `submit-for-decision` and `reject`
  // through and render a bare Reject button beside the Log decision CTA. The
  // module declaration is the second side of that guard.
  describe('RA-410: declaration-side filter for a stale backend', () => {
    test.each([['reject'], ['submit-for-decision']])(
      'hides %s even when the backend projects it as caller-invocable',
      async (actionId) => {
        registerReaccreditation()
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: aWorkItem({
            stateId: 'awaiting-decision',
            availableActions: [
              {
                actionId,
                displayName: 'Stale',
                fromStateId: 'awaiting-decision',
                toStateId: 'rejected',
                // What a pre-v12 backend sends.
                callerInvocable: true
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
          expect.stringContaining(`data-testid="action-${actionId}"`)
        )
      }
    )

    test('hides a declared-non-invocable action when the backend omits the flag entirely', async () => {
      // The oldest payload shape: no `callerInvocable` key at all, which
      // `isCallerInvocable` correctly reads as invocable for forward-compat.
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'awaiting-decision',
          availableActions: [
            {
              actionId: 'reject',
              displayName: 'Reject',
              fromStateId: 'awaiting-decision',
              toStateId: 'rejected'
            }
          ]
        })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-reject"')
      )
    })

    test('still renders actions the declaration does NOT mark non-invocable', async () => {
      // Guards against the filter over-reaching into a vacuous pass: the
      // Query link must survive alongside the suppressed decision actions.
      // RA-317: withdraw is no longer a Case Management service affordance,
      // so the query link is
      // now the survivor that proves the filter does not over-reach.
      registerReaccreditation()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'awaiting-decision',
          availableActions: [
            {
              actionId: 'reject',
              displayName: 'Reject',
              fromStateId: 'awaiting-decision',
              toStateId: 'rejected',
              callerInvocable: true
            },
            {
              actionId: 'query-during-decision',
              displayName: 'Query',
              fromStateId: 'awaiting-decision',
              toStateId: 'queried',
              callerInvocable: true
            }
          ]
        })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(result).toEqual(
        expect.stringContaining('data-testid="action-query"')
      )
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-reject"')
      )
    })
  })

  // RA-372 -----------------------------------------------------------------
  // Before this ticket an application sitting in `updated` (operator has
  // answered a query, caseworker has not yet picked the review back up) had
  // no onward route in the UI at all except Withdraw. The four
  // `continue-review-during-*` transitions that carry it back to the state
  // the query was raised from are declared `CallerInvocable: false` in the
  // backend and therefore never appear in `availableActions`, so the
  // generic action loop cannot render them — hence a bespoke CTA posting to
  // the type-specific endpoint.
  describe('RA-372 Continue review CTA (canContinueReview)', () => {
    function registerReaccreditationWithDetailV1() {
      registerReaccreditation()
      registerDetailTemplate(
        're-accreditation',
        'v1',
        're-accreditation/detail-v1'
      )
    }

    const updatedWorkItem = (overrides = {}) =>
      aWorkItem({
        stateId: 'updated',
        // RA-410. `taskStateId` is gone from the wire; management-be renamed
        // the surviving waypoint-origin field to `originStateId`. The
        // Continue review CTA no longer reads either — it keys off the state.
        originStateId: 'assessment-in-progress',
        assignedToId: 'someone-else',
        // What the backend actually returns for an item in `updated`: the
        // ORIGINATING state's tasks, with the pre-query completion intact.
        tasks: [
          {
            taskId: 'review-compliance-history',
            displayName: 'Review compliance history',
            status: 'Completed'
          },
          {
            taskId: 'assess-technical-capacity',
            displayName: 'Assess technical capacity',
            status: 'NotStarted'
          }
        ],
        availableActions: [
          {
            actionId: 'withdraw-during-updated',
            displayName: 'Withdraw',
            fromStateId: 'updated',
            toStateId: 'withdrawn',
            requiresAllTasksComplete: false
          }
        ],
        ...overrides
      })

    test('renders the Continue review CTA as a form POST to the type-specific endpoint', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({ ok: true, workItem: updatedWorkItem() })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining(
          'data-testid="re-accreditation-continue-review-cta"'
        )
      )
      expect(result).toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
      expect(result).toEqual(expect.stringContaining('Continue review'))
      // A real form POST, not a link to an interstitial.
      expect(result).toEqual(
        expect.stringContaining(
          `action="/work-items/re-accreditation/${ID}/continue-review"`
        )
      )
      // CSRF-protected like every other state-changing form on this page.
      expect(result).toMatch(
        /<form[^>]*continue-review"[^>]*>[\s\S]*?name="crumb"/
      )
    })

    // The whole point of the ticket: the outstanding tasks must be
    // reachable, so the CTA cannot be gated on completing them first.
    test('renders the CTA regardless of any legacy task data on the item', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({ ok: true, workItem: updatedWorkItem() })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      // Guards against a vacuous pass: the fixture really does have an
      // incomplete task.
      expect(result).toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
    })

    // AC1 / AC2 through the real template: the projected originating-state
    // tasks and their pre-query progress render through the existing
    // markup, and the "no tasks" message is gone.

    // RA-317: the updated-state item's only projected action is Withdraw,
    // which must NOT render in the Case Management service. The Continue
    // review CTA still renders
    // (it is a type-specific affordance, not a projected action), so this
    // now pins "CTA present, withdraw absent".
    test('renders the CTA and does not render the Withdraw link', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({ ok: true, workItem: updatedWorkItem() })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(result).toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-withdraw-during-updated"')
      )
    })

    // RA-335. The button is disabled rather than removed, matching the
    // other primary action buttons; `requireStandard` on the route is the
    // actual gate.
    test('renders the CTA disabled for a read-only support user', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({ ok: true, workItem: updatedWorkItem() })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`,
        headers: { 'x-test-user-role': 'support-readonly' }
      })

      expect(result).toMatch(
        /<button(?=[^>]*data-testid="action-continue-review")(?=[^>]*disabled)[^>]*>/
      )
    })

    test.each([
      'queried',
      'submitted',
      'duly-made',
      'assessment-in-progress',
      'awaiting-decision'
    ])('does not render the CTA in the %s state', async (stateId) => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId,
          // Explicitly NOT a waypoint: the tasks belong to the state the
          // item is actually in. Set deliberately rather than omitted, so
          // this asserts "same state means no CTA" rather than passing
          // vacuously because the field happens to be missing.
          taskStateId: stateId,
          availableActions: [
            {
              actionId: 'withdraw',
              displayName: 'Withdraw',
              fromStateId: stateId,
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
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
    })

    test('does not render the CTA in a terminal state', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({ stateId: 'withdrawn', availableActions: [] })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
    })

    // RA-372. The waypoint signal itself, isolated from any state id. The
    // CTA must key off "tasks belong to a different state", which is what
    // the backend actually tells us, and nothing else.
    // RA-410. These used to be keyed on `taskStateId` — "the tasks belong to
    // the current state" and "the envelope omits taskStateId". That field is
    // gone, and the CTA is now driven by the item's state alone, so the only
    // negative left is a state that the `continue-review-during-*`
    // transitions do not leave from.
    test.each(['submitted', 'duly-made', 'assessment-in-progress', 'queried'])(
      'does not render the CTA in %s',
      async (stateId) => {
        registerReaccreditationWithDetailV1()
        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: updatedWorkItem({ stateId })
        })

        const { statusCode, result } = await server.inject({
          method: 'GET',
          url: `/work-items/${ID}`
        })

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).not.toEqual(
          expect.stringContaining('data-testid="action-continue-review"')
        )
      }
    )

    // Backwards compatibility: an envelope from a backend that predates
    // `taskStateId` must not blow up or render a CTA whose POST the
    // backend would reject. It degrades to "no waypoint".
    // RA-410. The CTA must survive the removal of every task field — it is
    // the only path out of `updated` and it is NOT a task feature.
    test('still renders the CTA for an item carrying no task fields at all', async () => {
      registerReaccreditationWithDetailV1()
      const workItem = updatedWorkItem()
      delete workItem.tasks
      getWorkItem.mockResolvedValue({ ok: true, workItem })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
    })

    // RA-454. A query raised BEFORE the application was duly made carries it
    // to `updated` with `originStateId: 'submitted'`. Duly making is still
    // outstanding, so the SAME item is duly-makeable — without the origin
    // gate BOTH CTAs would render, and Continue review would run
    // `continue-review-during-duly-making`, dumping the item back into
    // `submitted` ("Not started"). The fix makes them mutually exclusive:
    // for the pre-duly-made waypoint only Duly make shows.
    test('suppresses the Continue review CTA and shows only Duly make when queried before duly making (origin submitted)', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: updatedWorkItem({ originStateId: 'submitted' })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      // canContinueReview === false: no Continue review CTA at all.
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
      expect(result).not.toEqual(
        expect.stringContaining(
          'data-testid="re-accreditation-continue-review-cta"'
        )
      )
      // canDulyMake === true: Duly make is the only onward CTA.
      expect(result).toEqual(
        expect.stringContaining('data-testid="re-accreditation-duly-make-cta"')
      )
    })

    // Regression guard for the normal continue-review path: a query raised
    // AFTER duly making (origin `assessment-in-progress`) still surfaces
    // Continue review, and Duly make stays hidden — the origin gate must not
    // over-reach and suppress the CTA it was only meant to suppress for
    // `submitted`.
    test('still shows Continue review (and not Duly make) when queried after duly making (origin assessment-in-progress)', async () => {
      registerReaccreditationWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: updatedWorkItem({ originStateId: 'assessment-in-progress' })
      })

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(statusCode).toBe(statusCodes.ok)
      // canContinueReview === true.
      expect(result).toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
      // canDulyMake === false: no Duly make CTA for a post-duly-made query.
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="re-accreditation-duly-make-cta"')
      )
    })

    // The CTA is re-accreditation-specific decoration; another registered
    // type sitting in a waypoint must not pick it up — detecting the
    // waypoint is generic, but the CTA that leaves it is the module's.
    test('does not render the CTA for a different work item type', async () => {
      registerWorkItemType({
        id: 'other-type',
        displayName: 'Other type',
        initialState: { id: 'updated', displayName: 'Updated' },
        states: [{ id: 'updated', displayName: 'Updated' }],
        getTasksForState: () => []
      })
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          typeId: 'other-type',
          stateId: 'updated',
          taskStateId: 'assessment-in-progress'
        })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
    })
  })

  // RA-372 x RA-346. Merging `main` brought two independent gates onto the
  // same page, both feeding decision affordances:
  //
  //   - RA-346's `canLogDecision`, answered by
  //     `evaluateApproveEligibility` against the DECLARED `approve`
  //     transition (`fromStateId: 'awaiting-decision'`,
  //     `requiresAllTasksComplete: true`), read from the RAW backend DTO.
  //   - RA-372's `canContinueReview`, answered by the generic
  //     `isTaskWaypoint` flag (`taskStateId !== stateId`).
  //
  // They are computed from different inputs and rendered by different
  // template blocks, so neither can override the other. What needs pinning
  // is that they stay MUTUALLY EXCLUSIVE in the one scenario where a naive
  // implementation would let both through: a query raised from
  // `awaiting-decision`, answered, with the decision task already complete.
  // Task-completeness alone must not surface Approve while the application
  // is still parked in the waypoint — the caseworker has to continue the
  // review first, which is the whole point of RA-372.
  describe('RA-372 x RA-346: the continue-review and approve gates compose', () => {
    function registerRealTypeWithDetailV1() {
      // The REAL declaration, not the trimmed stub: RA-346's gate reads the
      // shipped `approve` transition, so a type without transitions would
      // pass vacuously.
      registerWorkItemType(reAccreditationType)
      registerDetailTemplate(
        're-accreditation',
        'v1',
        're-accreditation/detail-v1'
      )
    }

    const decisionTaskComplete = [
      {
        taskId: 'record-decision-rationale',
        displayName: 'Record decision rationale',
        status: 'Completed'
      }
    ]

    test('in the waypoint with every task complete: Continue review, NOT Approve', async () => {
      registerRealTypeWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'updated',
          taskStateId: 'awaiting-decision',
          tasks: decisionTaskComplete,
          availableActions: [
            {
              actionId: 'withdraw-during-updated',
              displayName: 'Withdraw',
              fromStateId: 'updated',
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
        expect.stringContaining('data-testid="action-continue-review"')
      )
      // Complete tasks are NOT enough — the declared `approve` transition
      // is out of `awaiting-decision`, and this item is in `updated`.
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="log-decision-cta"')
      )
    })

    test('genuinely in awaiting-decision with every task complete: Approve, NOT Continue review', async () => {
      registerRealTypeWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'awaiting-decision',
          // Tasks belong to the state the item is actually in, so this is
          // not a waypoint.
          taskStateId: 'awaiting-decision',
          tasks: decisionTaskComplete,
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
        url: `/work-items/${ID}`
      })

      expect(result).toEqual(
        expect.stringContaining('data-testid="log-decision-cta"')
      )
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
    })

    test('RA-346 still gates on tasks inside the waypoint scenario', async () => {
      // Guards the above from passing for the wrong reason: with the task
      // PENDING, Approve is still absent and Continue review still shows,
      // so the first test's Approve-absence is attributable to the state
      // check rather than to task completeness.
      registerRealTypeWithDetailV1()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: aWorkItem({
          stateId: 'updated',
          taskStateId: 'awaiting-decision',
          tasks: [
            {
              taskId: 'record-decision-rationale',
              displayName: 'Record decision rationale',
              status: 'InProgress'
            }
          ],
          // Realistic: the backend always projects withdraw-during-updated
          // in this state, so an empty list here would encode a response
          // that cannot occur.
          availableActions: [
            {
              actionId: 'withdraw-during-updated',
              displayName: 'Withdraw',
              fromStateId: 'updated',
              toStateId: 'withdrawn',
              requiresAllTasksComplete: false
            }
          ]
        })
      })

      const { result } = await server.inject({
        method: 'GET',
        url: `/work-items/${ID}`
      })

      expect(result).toEqual(
        expect.stringContaining('data-testid="action-continue-review"')
      )
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="log-decision-cta"')
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
        // RA-503: operatorOrgNumber is the operator/regulator-safe value now displayed; see
        // case-header.test.js's "organisation id resolution" tests for the fallback coverage.
        operatorOrgNumber: 123001,
        registrationNumber: 'EPR-100999',
        material: 'plastic',
        siteAddress: '2 Wyld Court, Addingrove, AA3 1AA',
        prns: {
          plannedTonnageBand: 'UpTo5000',
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
    expect(header).toMatch(/case-header-org-id">123001</)
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
    expect(result).toContain('Up to 5,000 tonnes')
    expect(result).toContain('Harry Edge')
    expect(result).toContain('harry@example.com')
    expect(result).toContain('Sorting line investment')
    expect(result).toContain('80% of PRN income')
  })

  // RA-456. A regulator flagged that applicants cannot lawfully be
  // restricted to a fixed list of PRN-income categories, so a 7th "Other"
  // catch-all category was added, matching the pattern of the original six.
  test('RA-456: renders the "Other" business plan category for the current year', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        payload: {
          businessPlan: {
            newInfrastructurePercent: 80,
            newInfrastructureDetail: 'Sorting line investment',
            otherPercent: 20,
            otherDetail: 'Community recycling outreach'
          }
        }
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(detailRow(result, 'business-plan')).toContain(
      'Activities or investment not covered by the other categories'
    )
    expect(result).toContain('20% of PRN income')
    expect(result).toContain('Community recycling outreach')
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
          wasteProcessingType: 'exporter',
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
    // Even on an exporter the Type row must not claim "Exporter" — AC02 never
    // asked for that prefix on this row (see the comment on it in
    // application-summary.js). Positive assertion first, so the negative
    // below is scoped to a row that demonstrably exists.
    expect(detailRow(result, 'type')).toContain('Re-accreditation')
    expect(detailRow(result, 'type')).not.toContain('Exporter')
  })

  test('AC02: an unscanned BES evidence file is named but not linked', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        payload: {
          wasteProcessingType: 'exporter',
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

  // RA-456. The prior-year business plan renders through the same
  // `buildBusinessPlanPairs` as the current year, so the new "Other"
  // category must appear there too.
  test('RA-456: renders the "Other" business plan category for the prior year', async () => {
    getReAccreditationPriorYear.mockResolvedValue({
      ok: true,
      priorYear: {
        year: 2025,
        businessPlan: {
          priceSupportPercent: 40,
          otherPercent: 15,
          otherDetail: 'Prior-year community outreach'
        }
      }
    })
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    const priorYearStart = result.indexOf(
      'data-testid="prior-year-business-plan"'
    )
    const priorYearBusinessPlan = result.slice(
      priorYearStart,
      result.indexOf('</dd>', priorYearStart)
    )
    expect(priorYearBusinessPlan).toContain(
      'Activities or investment not covered by the other categories'
    )
    expect(priorYearBusinessPlan).toContain('15% of PRN income')
    expect(priorYearBusinessPlan).toContain('Prior-year community outreach')
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

  // RA-359 part 2. A withdrawn/terminal item reports the new `Cancelled` SLA
  // state (management-be) while KEEPING its `slaDueDate`. The header's "Due on"
  // must not present that frozen date as a live deadline: the cell still
  // renders (so the layout is stable) but its value degrades to the em dash,
  // exactly as for a work item whose clock never started. This does NOT
  // reintroduce the RA-295-removed SLA badge — asserted above.
  test('suppresses the header Due on date for a Cancelled SLA (withdrawn item)', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        stateId: 'withdrawn',
        slaState: 'Cancelled',
        slaDueDate: '2026-08-24T09:00:00Z'
      })
    })

    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    // The cell is still present (stable layout) but shows no live date.
    expect(result).toContain('data-testid="case-header-due-on"')
    expect(result).not.toContain('24 August 2026')
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

  // RA-292 ------------------------------------------------------------
  //
  // Rendering-level cover for the three "New" badges and the AC04 site
  // detail. The view-model rules themselves are pinned in
  // application-summary.test.js; what these assert is the markup contract the
  // e2e suite in epr-register-enrol-mgmt-tests reads, which cannot be checked
  // any other way.
  //
  // `data-testid` values here are an EXTERNAL CONTRACT — renaming one
  // silently skips the matching e2e assertion rather than failing it.

  // The generic `detailRow` helper slices to the first `</div>`, which the
  // RA-292 ORS block outgrew — it now nests a summary list inside the row. So
  // scope to the row's VALUE cell and run to the next row instead.
  //
  // For `ors`, which is the last row, that runs to the end of the document.
  // That is deliberate: every positive assertion below targets a testid that
  // appears nowhere else on the page, and an over-broad slice can only make
  // the NEGATIVE assertions stricter, never vacuous.
  function detailValue(html, key) {
    const start = html.indexOf(`data-testid="app-detail-value-${key}"`)
    if (start === -1) {
      throw new Error(
        `No application-details value cell "${key}" in the rendered page — a scoped assertion against it would pass vacuously.`
      )
    }
    const next = html.indexOf('data-testid="app-detail-row-', start)
    return html.slice(start, next === -1 ? undefined : next)
  }

  // The rendered TEXT of every element carrying `testId`, tags stripped and
  // whitespace collapsed — i.e. what `getText()` returns in the e2e suite.
  //
  // Prefix assertions MUST be scoped this way and never to a whole block.
  // An interim site renders INSIDE its parent ORS block, so the parent's text
  // contains its child's `NEW:`. A block-scoped absence check would then fail
  // on a correctly-rendered page whenever an established ORS holds a new
  // interim site, and — worse — a block-scoped presence check would PASS for
  // an ORS that is not new, because its child supplied the string. Neither
  // failure is visible in the assertion itself. (Raised by the mgmt-tests
  // teammate, which scopes to the same elements.)
  function lineTexts(html, testId) {
    const pattern = new RegExp(
      `<p[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</p>`,
      'g'
    )
    return [...html.matchAll(pattern)].map((match) =>
      match[1]
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
  }

  const ROTTERDAM = {
    orsId: 'ORS-2026-0292',
    siteName: 'Rotterdam New Reprocessing Site',
    addressLine1: '1 Havenstraat',
    addressLine2: 'Europoort Industrial Park',
    townOrCity: 'Rotterdam',
    country: 'Netherlands',
    coordinates: '51.9244, 4.4777',
    contactName: 'Johan de Vries',
    contactEmail: 'johan@example.com',
    contactPhone: '+31 10 123 4567',
    operationCodes: ['R3'],
    code1: 'B3011',
    code2: 'GH013',
    code3: 'Y48',
    repatriatedLoads: 0,
    conditionsOfExport: true,
    isNewSite: true,
    registeredNowAccredited: false,
    isEu: true,
    isOecd: true,
    interimSite: {
      siteNumber: 'INT-001',
      isNewSite: true,
      country: 'Belgium',
      siteName: 'Antwerp Interim Holding Site',
      addressLine1: '4 Scheldelaan',
      townOrCity: 'Antwerp',
      stateOrRegion: 'Flanders',
      postcode: '2030',
      contactName: 'Marieke Peeters',
      contactEmail: 'marieke@example.com',
      contactPhone: '+32 3 555 0100'
    }
  }

  const HAMBURG = {
    siteName: 'Hamburg Established Reprocessing Site',
    country: 'Germany',
    addressLine1: '9 Hafenstrasse',
    townOrCity: 'Hamburg',
    isNewSite: false,
    interimSite: {
      siteName: 'Bremen Interim Holding Site',
      country: 'Germany',
      isNewSite: false,
      addressLine1: '2 Weserstrasse',
      townOrCity: 'Bremen'
    }
  }

  const BILBAO = {
    orsId: 'ORS-2026-0003',
    siteName: 'Bilbao Legacy Reprocessing Site',
    siteAddress: 'Calle Uno, Bilbao',
    townOrCity: 'Bilbao',
    country: 'Spain'
  }

  async function renderWithSites(sites, payload = {}) {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: fullPayloadWorkItem({
        // RA-412: every caller of this helper is exercising ORS/BES
        // rendering, which now gates on the real `wasteProcessingType`
        // field rather than the presence of `overseasSites` — default it to
        // 'exporter' here so callers don't each have to repeat it.
        payload: {
          wasteProcessingType: 'exporter',
          overseasSites: { sites },
          ...payload
        }
      })
    })
    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })
    return result
  }

  test('RA-292 AC01: prefixes a new ORS, and only the new one', async () => {
    const ors = detailValue(
      await renderWithSites([ROTTERDAM, HAMBURG, BILBAO]),
      'ors'
    )

    // One prefix for three sites: the established and the legacy sites must
    // not carry one, or the flag tells a regulator nothing.
    expect(ors.match(/data-testid="overseas-site-new-tag"/g)).toHaveLength(1)
    expect(ors.match(/data-testid="overseas-site"/g)).toHaveLength(3)

    // Scoped per site name, so the prefix is proved to belong to the site
    // that declared itself new rather than merely to be somewhere on the page.
    // No parenthesised country: the design puts it at the end of the address.
    expect(lineTexts(ors, 'overseas-site-name')).toEqual([
      'NEW: Rotterdam New Reprocessing Site',
      'Hamburg Established Reprocessing Site',
      'Bilbao Legacy Reprocessing Site'
    ])
  })

  test('RA-292 AC01: the flag renders as a literal "NEW: " text prefix', async () => {
    const ors = detailValue(await renderWithSites([ROTTERDAM]), 'ors')
    const [name] = lineTexts(ors, 'overseas-site-name')

    expect(name).toBe('NEW: Rotterdam New Reprocessing Site')

    // The separator is an ASCII space, never U+00A0. A non-breaking space
    // renders identically and would silently break every downstream string
    // assertion — including the e2e suite's — while looking perfect.
    expect(name).not.toContain('\u00a0')
    expect(ors).toContain(
      '<span class="app-new-flag" data-testid="overseas-site-new-tag">NEW:</span> '
    )

    // Literal text, not styling: the design's affordance IS the word, so it
    // has to reach assistive technology and survive copy-paste. This also
    // pins that the superseded blue tag does not come back.
    expect(ors).not.toContain('govuk-tag--blue')
  })

  // The colour is ADDITIVE. `name` above is the rendered TEXT with all markup
  // stripped, and it already reads "NEW: ..." — so this test proves the word
  // survives without any styling at all, which is what makes colouring it
  // safe for a colour-blind or screen-reader user. If someone ever swaps the
  // text for a ::before or an icon, the assertion above fails, not this one.
  test('RA-292 AC01: the colour is carried by a class, never by inline style', async () => {
    const ors = detailValue(await renderWithSites([ROTTERDAM]), 'ors')

    expect(ors).toContain('class="app-new-flag"')
    // Inline styles would be blocked by the deny-all CSP anyway, so a colour
    // that only ever appeared inline would silently not render at all.
    expect(ors).not.toMatch(/data-testid="overseas-site-new-tag"[^>]*style=/)
  })

  test.each([
    ['false', false],
    ['null', null],
    ['absent', undefined]
  ])(
    'RA-292 AC01: renders NO prefix at all when isNewSite is %s',
    async (_label, isNewSite) => {
      const ors = detailValue(
        await renderWithSites([{ ...ROTTERDAM, isNewSite }]),
        'ors'
      )
      // Positive assertion first, so the negatives are scoped to a block that
      // demonstrably rendered.
      expect(ors).toContain('data-testid="overseas-site"')
      // Absent from the DOM, not empty and not hidden.
      expect(ors).not.toContain('overseas-site-new-tag')
      expect(lineTexts(ors, 'overseas-site-name')[0]).not.toContain('NEW:')
    }
  )

  test('RA-292 AC02: renders the interim site, nested inside its parent ORS', async () => {
    const ors = detailValue(await renderWithSites([ROTTERDAM]), 'ors')

    const parentIdx = ors.indexOf('data-testid="overseas-site"')
    const interimIdx = ors.indexOf('data-testid="interim-site"')
    expect(interimIdx).toBeGreaterThan(parentIdx)
    expect(ors).toContain('Antwerp Interim Holding Site')
    expect(ors).toContain('data-testid="interim-site-new-tag"')
  })

  test('RA-292 AC02: prefixes only the new interim site', async () => {
    const ors = detailValue(await renderWithSites([ROTTERDAM, HAMBURG]), 'ors')

    expect(ors.match(/data-testid="interim-site"/g)).toHaveLength(2)
    expect(ors.match(/data-testid="interim-site-new-tag"/g)).toHaveLength(1)

    expect(lineTexts(ors, 'interim-site-name')).toEqual([
      'NEW: Antwerp Interim Holding Site',
      'Bremen Interim Holding Site'
    ])
  })

  // The trap the nesting creates, pinned explicitly: an established ORS
  // holding a NEW interim site. The parent block's text contains "NEW:"
  // because its child supplied it, so only a name-scoped assertion tells the
  // two apart — and getting it wrong fails silently in BOTH directions (a
  // block-scoped absence check fails on a correct page; a block-scoped
  // presence check passes for a site that is not new).
  test('RA-292 AC02: a not-new ORS holding a new interim site prefixes only the child', async () => {
    const ors = detailValue(
      await renderWithSites([
        { ...HAMBURG, interimSite: { ...HAMBURG.interimSite, isNewSite: true } }
      ]),
      'ors'
    )

    expect(lineTexts(ors, 'overseas-site-name')).toEqual([
      'Hamburg Established Reprocessing Site'
    ])
    expect(lineTexts(ors, 'interim-site-name')).toEqual([
      'NEW: Bremen Interim Holding Site'
    ])
    // The parent block's text DOES carry the child's prefix. This is the
    // assertion that would mislead if it were the only one.
    expect(ors).toContain('NEW:')
    expect(ors).not.toContain('data-testid="overseas-site-new-tag"')
  })

  test('RA-292 AC02: renders the "Interim sites" sub-label', async () => {
    const ors = detailValue(await renderWithSites([ROTTERDAM]), 'ors')
    const interimIdx = ors.indexOf('data-testid="interim-site"')
    expect(ors.slice(interimIdx, interimIdx + 600)).toContain(
      '<strong>Interim sites</strong>'
    )
  })

  test('RA-292 AC02: an ORS with no interim site renders no interim block', async () => {
    const ors = detailValue(await renderWithSites([BILBAO]), 'ors')
    expect(ors).toContain('Bilbao Legacy Reprocessing Site')
    expect(ors).not.toContain('interim-site')
  })

  test('RA-292 AC03: prefixes only the new authority-to-issue contact', async () => {
    const authority = detailValue(
      await renderWithSites([], {
        prns: {
          plannedTonnageBand: 'UpTo5000',
          authorisers: [
            {
              fullName: 'Grace Adeyemi',
              email: 'grace@example.com',
              isNew: true
            },
            {
              fullName: 'Martin Cole',
              email: 'martin@example.com',
              isNew: false
            },
            { fullName: 'Priya Nair', email: 'priya@example.com' }
          ]
        }
      }),
      'authority-to-issue'
    )

    expect(
      authority.match(/data-testid="authority-to-issue-contact"/g)
    ).toHaveLength(3)
    expect(
      authority.match(/data-testid="authority-to-issue-new-tag"/g)
    ).toHaveLength(1)

    expect(lineTexts(authority, 'authority-to-issue-contact')).toEqual([
      'NEW: Grace Adeyemi (grace@example.com)',
      'Martin Cole (martin@example.com)',
      'Priya Nair (priya@example.com)'
    ])
  })

  // Unlike the site blocks, the prefix sits OUTSIDE the contact-name element:
  // that element means "the contact's name", so folding "NEW:" into it would
  // stop its text being the name. Pinned because it is the difference between
  // the e2e suite asserting on the right element and asserting on one that
  // can never contain the prefix — which would pass forever.
  test('RA-292 AC03: the prefix is on the contact line, not inside the name', async () => {
    const authority = detailValue(
      await renderWithSites([], {
        prns: {
          plannedTonnageBand: 'UpTo5000',
          authorisers: [
            {
              fullName: 'Grace Adeyemi',
              email: 'grace@example.com',
              isNew: true
            }
          ]
        }
      }),
      'authority-to-issue'
    )

    expect(authority).toContain(
      '<span class="app-new-flag" data-testid="authority-to-issue-new-tag">NEW:</span> <span data-testid="authority-to-issue-contact-name">Grace Adeyemi</span>'
    )
  })

  test('RA-292 AC03: contact text is still "Name (email)"', async () => {
    // The row changed shape from flat lines to per-contact blocks. The
    // RENDERED TEXT must not change with it: it is the only place the
    // authoriser email appears on the page.
    const authority = detailValue(
      await renderWithSites([]),
      'authority-to-issue'
    )
    expect(authority).toContain('data-testid="authority-to-issue-contact-name"')
    expect(authority).toContain('Harry Edge')
    expect(authority).toContain('(harry@example.com)')
  })

  test('RA-292 AC03: an application with no authorisers renders an em dash', async () => {
    const authority = detailValue(
      await renderWithSites([], { prns: { plannedTonnageBand: 'UpTo5000' } }),
      'authority-to-issue'
    )
    expect(authority).not.toContain('authority-to-issue-contact')
    expect(authority).toContain('—')
  })

  test('RA-292 AC04: renders every ORS detail field with its own hook', async () => {
    const ors = detailValue(await renderWithSites([ROTTERDAM]), 'ors')

    for (const [testId, value] of [
      ['overseas-site-ors-id', 'ORS-2026-0292'],
      ['overseas-site-coordinates', '51.9244, 4.4777'],
      ['overseas-site-contact-name', 'Johan de Vries'],
      ['overseas-site-contact-email', 'johan@example.com'],
      ['overseas-site-contact-phone', '+31 10 123 4567'],
      ['overseas-site-operation-code', 'R3'],
      ['overseas-site-waste-codes', 'B3011, GH013, Y48'],
      // Zero and false are ANSWERS. A truthiness guard anywhere on the
      // render path would drop exactly these two rows and nothing else,
      // which is why they are asserted by value and not merely by presence.
      ['overseas-site-repatriated-loads', '0'],
      // A nullable boolean on the wire, not free text.
      ['overseas-site-conditions-of-export', 'Yes'],
      ['overseas-site-registered-now-accredited', 'No'],
      ['overseas-site-eu-country', 'Yes'],
      ['overseas-site-oecd-country', 'Yes']
    ]) {
      const idx = ors.indexOf(`data-testid="${testId}"`)
      expect(idx, `${testId} is missing from the ORS row`).toBeGreaterThan(-1)
      expect(ors.slice(idx, idx + 400)).toContain(value)
    }

    // The address is no longer a labelled detail row: the design puts it on
    // ONE flowing comma-separated line directly beneath the site name. One
    // element, not one per part — a per-part rendering let a `toContain`
    // assertion pass while silently dropping addressLine2.
    expect(ors.match(/data-testid="overseas-site-address"/g)).toHaveLength(1)
    expect(lineTexts(ors, 'overseas-site-address')).toEqual([
      '1 Havenstraat, Europoort Industrial Park, Rotterdam, Netherlands'
    ])
    const nameIdx = ors.indexOf('data-testid="overseas-site-name"')
    const addressIdx = ors.indexOf('data-testid="overseas-site-address"')
    const detailIdx = ors.indexOf('data-testid="overseas-site-ors-id"')
    expect(addressIdx).toBeGreaterThan(nameIdx)
    expect(addressIdx).toBeLessThan(detailIdx)
    expect(ors).toContain('Basel/OECD codes')
  })

  test('RA-292 AC04: renders every interim site detail field with its own hook', async () => {
    const ors = detailValue(await renderWithSites([ROTTERDAM]), 'ors')

    // One flowing line, country last, exactly as for the ORS.
    expect(lineTexts(ors, 'interim-site-address')).toEqual([
      '4 Scheldelaan, Antwerp, Flanders, 2030, Belgium'
    ])

    for (const [testId, value] of [
      ['interim-site-site-number', 'INT-001'],
      ['interim-site-contact-name', 'Marieke Peeters'],
      ['interim-site-contact-email', 'marieke@example.com'],
      ['interim-site-contact-phone', '+32 3 555 0100']
    ]) {
      const idx = ors.indexOf(`data-testid="${testId}"`)
      expect(
        idx,
        `${testId} is missing from the interim block`
      ).toBeGreaterThan(-1)
      expect(ors.slice(idx, idx + 400)).toContain(value)
    }

    // Country is the LAST part of the address, not a parenthetical on the
    // name line — pinned by the full-string assertion above.
  })

  test('RA-292 AC04: omits the fields a near-minimal site does not carry', async () => {
    const ors = detailValue(await renderWithSites([BILBAO]), 'ors')

    expect(ors).toContain('data-testid="overseas-site-ors-id"')
    expect(ors).toContain('data-testid="overseas-site-address"')
    // The legacy flat address survives — a pre-RA-292 site has no
    // addressLine1, and leading with the structured `townOrCity` alone would
    // drop the street.
    expect(ors).toContain('Calle Uno, Bilbao')
    for (const testId of [
      'overseas-site-coordinates',
      'overseas-site-contact-name',
      'overseas-site-operation-code',
      'overseas-site-waste-codes',
      'overseas-site-repatriated-loads',
      'overseas-site-eu-country'
    ]) {
      expect(ors, `${testId} should be omitted, not em-dashed`).not.toContain(
        testId
      )
    }
  })

  test('RA-292: BES evidence blocks are bes-site, never overseas-site', async () => {
    // Both rows used to emit `overseas-site`, so a per-site e2e lookup
    // matched 2N blocks and could not tell an ORS from its BES evidence.
    const result = await renderWithSites([
      {
        ...ROTTERDAM,
        besEvidence: {
          files: [
            { fileId: 'b-1', filename: 'bes-evidence.pdf', scanStatus: 'Clean' }
          ]
        }
      }
    ])

    const bes = detailValue(result, 'bes')
    expect(bes).toContain('data-testid="bes-site"')
    expect(bes).toContain('bes-evidence.pdf')
    expect(bes).not.toContain('data-testid="overseas-site"')
    // ...and the ORS row still carries exactly one site block.
    expect(
      detailValue(result, 'ors').match(/data-testid="overseas-site"/g)
    ).toHaveLength(1)
  })

  test('RA-292: a pre-story work item renders with no New tag anywhere', async () => {
    // The backwards-compatibility path: every RA-292 field is optional and
    // items already in Mongo carry none of them.
    getWorkItem.mockResolvedValue({ ok: true, workItem: fullPayloadWorkItem() })
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('data-testid="application-details"')
    expect(result).not.toContain('-new-tag')
    expect(result).not.toContain('NEW:')
    expect(result).not.toContain('data-testid="app-detail-row-ors"')
  })
})
