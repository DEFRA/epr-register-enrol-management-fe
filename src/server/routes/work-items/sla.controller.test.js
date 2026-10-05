import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

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
  extendWorkItemSla: vi.fn(),
  updateRecyclingOperations: vi.fn()
}))

const { extendWorkItemSla, getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '22222222-2222-2222-2222-222222222222'
const REF = 'RA-123456789'

// Fixed "current due date" used by the extend fixtures below, so a new
// deadline of 2026-07-01 is unambiguously an extension.
const CURRENT_DUE_DATE = '2026-06-01T00:00:00Z'

// RA-611's duly-made anchor travels on the work item itself: management-be
// projects `slaStartedAt` off the same SLA clock as `slaDueDate`. The floor's
// other half is 1 January of the CURRENT CALENDAR YEAR, read from the clock —
// NOT from `payload.accreditationYear`, which is the year the accreditation is
// valid for and floored live 2026 cases at 1 Jan 2027 until QA caught it.
//
// Duly made on 3 March 2026, later than 1 January 2026, so the DULY-MADE bound
// binds for every case below. That only holds while the clock reads 2026, so
// the suite pins it — otherwise these expectations would change on 1 January.
const NOW = new Date('2026-10-05T09:00:00Z')
const SLA_STARTED_AT = '2026-03-03T00:00:00Z'
const aWorkItem = {
  id: ID,
  payload: { applicationReference: REF, accreditationYear: 2026 },
  slaDueDate: CURRENT_DUE_DATE,
  slaStartedAt: SLA_STARTED_AT
}

const DULY_MADE_MESSAGE =
  'The new determination deadline cannot be earlier than 3 March 2026, when the application was duly made'
const JANUARY_MESSAGE =
  'The new determination deadline cannot be earlier than 1 January 2026'

const VALID_DEADLINE_PAYLOAD =
  'new-deadline-day=1&new-deadline-month=7&new-deadline-year=2026'

// Only `Date` is faked: the Hapi server's own timers (request timeouts, the
// session cache) must keep running normally while the determination-deadline
// floor sees a fixed calendar year.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterAll(() => {
  vi.useRealTimers()
})

/**
 * The page's prose with every attribute value and href stripped out, so an
 * "extend" assertion (RA-572 AC02) reads the words a regulator sees and not
 * the `/sla/extend` route, the `sla-extend-*` testids or the `new-deadline`
 * field names — all of which RA-572 deliberately leaves alone.
 */
function visibleText(html) {
  return String(html).replace(/<[^>]*>/g, ' ')
}

/**
 * POST a valid change to the determination deadline, then follow the
 * redirect back to the detail page IN THE SAME SESSION and return what it
 * rendered. The failure banners are flashed into the yar session rather
 * than rendered inline, so asserting on the POST response alone proves only
 * that a redirect happened — never which banner the caseworker will read.
 */
async function submitAndFollowRedirect(server) {
  const posted = await injectWithCrumb(server, {
    method: 'POST',
    url: `/work-items/${ID}/sla/extend`,
    payload: `reason=Some+reason&${VALID_DEADLINE_PAYLOAD}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })

  expect(posted.statusCode).toBe(statusCodes.redirect)
  expect(posted.headers.location).toBe(`/work-items/${ID}`)

  const cookies = []
    .concat(posted.headers['set-cookie'] ?? [])
    .map((header) => header.split(';')[0])
    .join('; ')

  const followed = await server.inject({
    method: 'GET',
    url: `/work-items/${ID}`,
    headers: { cookie: cookies }
  })

  return followed.result
}

describe('#makeShowExtendController', () => {
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
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem })
  })

  test('GET renders the change determination deadline form', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/extend`
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('Change determination deadline')
    )
    expect(result).toEqual(expect.stringContaining('sla-extend-form'))
    expect(result).toEqual(expect.stringContaining('sla-extend-days'))
    expect(result).toEqual(expect.stringContaining(REF))
  })

  // The other half of the shared loader's failure handling: anything that
  // is not a 404 is a backend problem, not a missing application, so it
  // renders the "unavailable" page at 502 with the backend's own reason —
  // never the not-found copy, which would tell a caseworker the
  // application does not exist when the backend is merely down.
  test('GET renders the 502 unavailable page when the backend fails', async () => {
    getWorkItem.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'upstream unavailable'
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/extend`
    })

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(result).toEqual(expect.stringContaining('Work item unavailable'))
    expect(result).toEqual(expect.stringContaining('upstream unavailable'))
    expect(result).not.toEqual(expect.stringContaining('Application not found'))
  })

  // RA-358 AC2. This route is one of the nine callers of the shared
  // not-found view, but had no 404 coverage at all, so its copy could
  // drift back without anything failing.
  test('GET renders the 404 page in application terms', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/extend`
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Application not found'))
    // The breadcrumb must speak the same vocabulary as the heading and the
    // back link, all three of which point at /work-items. Scoped to the
    // breadcrumb class: the header nav also renders a "Work items" link, so
    // a bare substring check would be ambiguous.
    expect(result).toContain(
      '<a class="govuk-breadcrumbs__link" href="/work-items">Applications</a>'
    )
    expect(result).not.toEqual(expect.stringContaining('No work item exists'))
  })
})

describe('#makeSubmitExtendController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    extendWorkItemSla.mockReset()
    getWorkItem.mockReset()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem })
  })

  test('POST with a valid new deadline applies the extension and redirects to detail', async () => {
    extendWorkItemSla.mockResolvedValue({ ok: true, workItem: { id: ID } })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Need+more+time&${VALID_DEADLINE_PAYLOAD}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    // 2026-06-01 → 2026-07-01 is 30 days.
    expect(extendWorkItemSla).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        reason: 'Need more time',
        additionalDuration: 'P30D'
      })
    )
  })

  test('POST with empty reason re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=&${VALID_DEADLINE_PAYLOAD}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(result).toEqual(expect.stringContaining('Reason is required'))
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })

  test('POST with an invalid date re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload:
        'reason=Some+reason&new-deadline-day=31&new-deadline-month=2&new-deadline-year=2026',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(result).toEqual(
      expect.stringContaining('Determination deadline must be a real date')
    )
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })

  // RA-601's surviving half: the deadline may be brought forward as well as
  // pushed back, provided (since RA-611) it lands on or above the floor. An
  // earlier date goes through the same route to the same backend call, with a
  // negative duration and no extra confirmation step.
  test('POST with an earlier but still future new deadline applies the change and redirects to detail', async () => {
    extendWorkItemSla.mockResolvedValue({ ok: true, workItem: { id: ID } })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload:
        'reason=Brought+forward&new-deadline-day=27&new-deadline-month=5&new-deadline-year=2026',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    // 2026-06-01 → 2026-05-27 is 5 days earlier.
    expect(extendWorkItemSla).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: ID,
        reason: 'Brought forward',
        additionalDuration: '-P5D'
      })
    )
  })

  // RA-611 end to end: a deadline below the floor must never reach the backend,
  // and the caseworker must see why — in the error summary AND on the date
  // input — with what they typed still in the boxes. 2 March 2026 is the day
  // before the duly-made date, so the message names that date.
  test('POST with a deadline below the duly-made floor re-renders form with 400 and the RA-611 error', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload:
        'reason=Brought+forward+too+far&new-deadline-day=2&new-deadline-month=3&new-deadline-year=2026',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(extendWorkItemSla).not.toHaveBeenCalled()

    // The GOV.UK error summary, anchored at the DAY box rather than at the
    // reason field — a date problem must focus the date input.
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(result).toEqual(
      expect.stringContaining('data-testid="sla-extend-error-summary"')
    )
    expect(result).toEqual(expect.stringContaining('href="#new-deadline-day"'))
    expect(result).not.toEqual(expect.stringContaining('href="#field-reason"'))

    // The field-level error on the date input.
    expect(result).toEqual(expect.stringContaining('id="new-deadline-error"'))
    expect(result).toEqual(expect.stringContaining('govuk-input--error'))

    // Exactly twice: once in the summary, once under the date input.
    const occurrences = String(result).split(DULY_MADE_MESSAGE).length - 1
    expect(occurrences).toBe(2)

    // What the caseworker typed survives the re-render.
    expect(result).toEqual(expect.stringContaining('value="2"'))
    expect(result).toEqual(expect.stringContaining('value="3"'))
    expect(result).toEqual(expect.stringContaining('value="2026"'))
    expect(visibleText(result)).toEqual(
      expect.stringContaining('Brought forward too far')
    )
  })

  // The OTHER bound, end to end, and the exact shape of the QA case-blocker:
  // an application duly made in the previous calendar year, so 1 January of the
  // current year binds. The message must name 1 January 2026 — the year the
  // clock reads — and never the accreditation year the payload carries.
  test('POST with a deadline below 1 January re-renders form with 400 naming the current year', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        ...aWorkItem,
        payload: { ...aWorkItem.payload, accreditationYear: 2027 },
        slaStartedAt: '2025-11-20T00:00:00Z'
      }
    })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload:
        'reason=Backdated+into+last+year&new-deadline-day=15&new-deadline-month=12&new-deadline-year=2025',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(extendWorkItemSla).not.toHaveBeenCalled()

    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(result).toEqual(expect.stringContaining('href="#new-deadline-day"'))
    expect(result).toEqual(expect.stringContaining('id="new-deadline-error"'))

    // Once in the summary, once under the date input — and naming 2026, the
    // current calendar year, not the payload's 2027 accreditation year.
    const occurrences = String(result).split(JANUARY_MESSAGE).length - 1
    expect(occurrences).toBe(2)
    expect(result).not.toEqual(expect.stringContaining('1 January 2027'))

    // What the caseworker typed survives the re-render.
    expect(result).toEqual(expect.stringContaining('value="15"'))
    expect(result).toEqual(expect.stringContaining('value="12"'))
    expect(result).toEqual(expect.stringContaining('value="2025"'))
  })

  // The boundary: the floor date itself is allowed, so the same form that
  // rejects 2 March accepts 3 March and reaches the backend. This date is also
  // in the PAST, which the 29 Sep 2026 spec makes legitimate — the first cut of
  // RA-611 would have rejected it.
  test('POST with the duly-made date as the new deadline applies the change', async () => {
    extendWorkItemSla.mockResolvedValue({ ok: true, workItem: { id: ID } })

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload:
        'reason=Backdate+to+duly+made&new-deadline-day=3&new-deadline-month=3&new-deadline-year=2026',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    // 2026-06-01 → 2026-03-03 is 90 days earlier.
    expect(extendWorkItemSla).toHaveBeenCalledWith(
      expect.objectContaining({ additionalDuration: '-P90D' })
    )
  })

  // RA-601: the one surviving date rejection. Resubmitting the current
  // deadline changes nothing, so it is rejected as a no-op.
  test('POST with an unchanged deadline re-renders form with 400', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload:
        'reason=Some+reason&new-deadline-day=1&new-deadline-month=6&new-deadline-year=2026',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(
      expect.stringContaining(
        'The new determination deadline must be different from the current deadline'
      )
    )
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })

  // These two used to mock `outcome:` on the backend client's result. The
  // client returns `reason:` — `extendSla` maps `reason` onto `outcome` —
  // so the mocks fell through to the unmapped-failure default and the
  // forbidden / conflict banners they are named after were never reached.
  // Mocking `reason` is what the real client does, and the banner text is
  // asserted on the page the caseworker actually lands on, so the mapping
  // cannot silently regress again.
  test.each([
    [
      'forbidden',
      403,
      'Forbidden',
      'You do not have permission to perform this action.'
    ],
    [
      'conflict',
      409,
      'Conflict',
      'The work item state changed. Refresh and try again.'
    ],
    ['not-found', 404, 'Missing', 'The work item could not be found.']
  ])(
    'POST flashes the %s banner and redirects to the detail page',
    async (reason, status, message, expectedText) => {
      extendWorkItemSla.mockResolvedValue({
        ok: false,
        reason,
        status,
        message
      })

      const banner = await submitAndFollowRedirect(server)

      expect(banner).toEqual(
        expect.stringContaining('Could not change the determination deadline')
      )
      expect(banner).toEqual(expect.stringContaining(expectedText))
    }
  )

  // The unmapped default: anything the SLA_REASON_BY_STATUS map does not
  // recognise surfaces the backend's own message rather than inventing one,
  // under a generic title. RA-572 reworded the last-resort text off "SLA".
  test('POST surfaces the backend message for an unmapped failure', async () => {
    extendWorkItemSla.mockResolvedValue({
      ok: false,
      reason: 'server',
      status: 500,
      message: 'Backend exploded'
    })

    const banner = await submitAndFollowRedirect(server)

    expect(banner).toEqual(expect.stringContaining('Action failed'))
    expect(banner).toEqual(expect.stringContaining('Backend exploded'))
    expect(banner).not.toEqual(expect.stringContaining('SLA'))
  })

  // Same path with no message at all — the fallback sentence, which must
  // speak of the determination deadline and never of "the SLA" (RA-447
  // retired that as user-facing wording, RA-572 finished the job here).
  test('POST falls back to determination-deadline wording with no message', async () => {
    extendWorkItemSla.mockResolvedValue({ ok: false, reason: 'server' })

    const banner = await submitAndFollowRedirect(server)

    expect(banner).toEqual(
      expect.stringContaining(
        'The determination deadline could not be updated.'
      )
    )
  })

  // RA-358 AC2 equivalent for the submit path: the work item is now fetched
  // on every submit (RA-447 CM6 needs its slaDueDate before validating), so
  // this path needs the same 404 coverage as the GET handler.
  test('POST renders the 404 page when the work item does not exist', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Some+reason&${VALID_DEADLINE_PAYLOAD}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Application not found'))
    expect(extendWorkItemSla).not.toHaveBeenCalled()
  })
})

// RA-572 AC01/AC02. The Override journey is deleted, not disabled: both of
// its routes must be UNROUTABLE, and the Change page must speak only of a
// change. Asserted here rather than only in the e2e suite because the
// 404 is what stops a bookmarked or crafted Override request from
// resurfacing a withdrawn journey.
describe('RA-572 Override removal and Change copy', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    extendWorkItemSla.mockReset()
    getWorkItem.mockReset()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem })
  })

  test.each(['GET', 'POST'])(
    '%s /sla/override is no longer routable',
    async (method) => {
      const { statusCode } =
        method === 'GET'
          ? await server.inject({
              method,
              url: `/work-items/${ID}/sla/override`
            })
          : await injectWithCrumb(server, {
              method,
              url: `/work-items/${ID}/sla/override`,
              payload: 'reason=Some+reason&newTargetDays=30',
              headers: {
                'content-type': 'application/x-www-form-urlencoded'
              }
            })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(getWorkItem).not.toHaveBeenCalled()
    }
  )

  // AC06. Removing Override must not take Change with it.
  test('the Change journey still renders and still saves', async () => {
    extendWorkItemSla.mockResolvedValue({ ok: true, workItem: { id: ID } })

    const { statusCode: getStatus } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/extend`
    })
    expect(getStatus).toBe(statusCodes.ok)

    const { statusCode, headers } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=Needs+longer&${VALID_DEADLINE_PAYLOAD}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toBe(`/work-items/${ID}`)
    expect(extendWorkItemSla).toHaveBeenCalled()
  })

  // AC02. One assertion per string the regulator actually reads, plus a
  // blanket check that no "extend"/"extending" wording survived anywhere on
  // the page — that blanket check is what catches copy re-introduced by a
  // later edit to the template.
  test('the Change page uses change terminology throughout', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/extend`
    })

    expect(result).toEqual(
      expect.stringContaining('Change determination deadline')
    )
    expect(result).toEqual(expect.stringContaining('Reason for change'))
    expect(result).toEqual(
      expect.stringContaining(
        'Explain why the determination deadline needs to be changed.'
      )
    )
    expect(result).toEqual(
      expect.stringContaining('New determination deadline')
    )
    // The form action, the testids and the field names all still say
    // "extend" by design, so check the PROSE only.
    expect(visibleText(result)).not.toMatch(/extend/i)
  })

  // The testids the e2e journeys key off are part of the contract: RA-572
  // changes copy, never wiring.
  test('keeps every sla-extend testid and the /sla/extend form action', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: `/work-items/${ID}/sla/extend`
    })

    for (const testId of [
      'sla-extend-form',
      'sla-extend-reason',
      'sla-extend-days',
      'sla-extend-submit',
      'sla-extend-cancel'
    ]) {
      expect(result).toEqual(expect.stringContaining(`data-testid="${testId}"`))
    }
    expect(result).toEqual(
      expect.stringContaining(`action="/work-items/${ID}/sla/extend"`)
    )
  })

  test('the validation error summary uses change terminology', async () => {
    const { statusCode, result } = await injectWithCrumb(server, {
      method: 'POST',
      url: `/work-items/${ID}/sla/extend`,
      payload: `reason=&${VALID_DEADLINE_PAYLOAD}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('sla-extend-error-summary'))
    expect(visibleText(result)).not.toMatch(/extend/i)
  })
})
