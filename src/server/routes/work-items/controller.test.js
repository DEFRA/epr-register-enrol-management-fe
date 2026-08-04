import { vi, beforeEach, afterEach } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { config } from '#/config/config.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  getBackendHealth: vi.fn(),
  raiseWorkItemQuery: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  addWorkItemNote: vi.fn()
}))

const { getWorkItems } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

function emptyPage(overrides = {}) {
  return {
    ok: true,
    items: [],
    totalCount: 0,
    page: 1,
    pageSize: 20,
    ...overrides
  }
}

describe('#workItemListController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItems.mockReset()
    // The plugin clears the registry on each createServer registration; tests
    // that need a known type must register it after server boot.
  })

  test('Renders the empty state when the backend has no items', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    // RA-324. The page is now titled "Applications" (the nav link stays
    // "Work items").
    expect(result).toEqual(expect.stringContaining('Applications |'))
    // Empty state (no items AND no filters) shows main's two-line message
    // (merged from feature/work-items-empty-state-message).
    expect(result).toEqual(expect.stringContaining('No items to process.'))
    expect(result).toEqual(
      expect.stringContaining(
        'There are currently no work items to display. New items will appear here as they are received.'
      )
    )
  })

  test('Renders submitted items as cards with the state badge label', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Not started' },
      states: [
        { id: 'submitted', displayName: 'Not started' },
        { id: 'approved', displayName: 'Granted', isTerminal: true }
      ],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: 'frontend',
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    // The tile is keyed by the work item id (href + testids).
    expect(result).toEqual(
      expect.stringContaining('11111111-1111-1111-1111-111111111111')
    )
    // RA-324 phase-2: applicant type on the card is always the literal
    // "Reprocessor" (not the work-item type display name).
    expect(result).toEqual(
      expect.stringContaining('data-testid="applicant-type">Reprocessor</span>')
    )
    // State badge text = the state display name (RA-324 contract label).
    expect(result).toEqual(expect.stringContaining('Not started'))
    // Status renders as a coloured govuk-tag (AC07/AC08); submitted = grey.
    expect(result).toEqual(
      expect.stringContaining(
        'data-testid="work-item-state-tag-11111111-1111-1111-1111-111111111111"'
      )
    )
    expect(result).toEqual(expect.stringContaining('govuk-tag govuk-tag--grey'))
    // Rendered as a tile, not the old table.
    expect(result).toEqual(
      expect.stringContaining('data-testid="application-tile"')
    )
    expect(result).not.toEqual(
      expect.stringContaining('data-testid="work-items-table"')
    )
  })

  // RA-196: the visible link text shows the user-facing application
  // reference (payload.applicationReference) while the href and the
  // data-testid keep using the internal work item id.
  test('Renders the application reference as the link text, keeping the id in the href and testid', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: 'frontend',
            payload: { applicationReference: 'RA-123456789' }
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    // Visible link text is the application reference.
    expect(result).toEqual(expect.stringContaining('>RA-123456789</a>'))
    // The href and data-testid keep the internal id.
    expect(result).toEqual(
      expect.stringContaining(
        'href="/work-items/11111111-1111-1111-1111-111111111111"'
      )
    )
    expect(result).toEqual(
      expect.stringContaining(
        'data-testid="work-item-link-11111111-1111-1111-1111-111111111111"'
      )
    )
  })

  // RA-249: the "Application ref" column must show the human RA-* reference
  // or NOTHING — never the work-item Guid. When applicationReference is
  // absent the link text is empty, but the href/data-testid keep the id so
  // navigation is preserved.
  test('RA-249: Application ref link text is empty (never the id) when applicationReference is missing, keeping the id in the href', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    const id = '22222222-2222-2222-2222-222222222222'
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id,
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: 'frontend',
            payload: { applicantName: 'Acme' } // No applicationReference
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    // The id must NOT be used as the visible link text.
    expect(result).not.toEqual(expect.stringContaining(`>${id}</a>`))
    // The href and data-testid still carry the id, so navigation works.
    expect(result).toEqual(expect.stringContaining(`href="/work-items/${id}"`))
    expect(result).toEqual(
      expect.stringContaining(`data-testid="work-item-link-${id}"`)
    )
    // RA-249 accessibility (WCAG 2.4.4): the visible cell stays blank, but
    // the link still has an accessible name via a visually-hidden fallback,
    // so it is never a text-less link.
    expect(result).toEqual(
      expect.stringContaining(
        `data-testid="work-item-link-${id}"><span class="govuk-visually-hidden">View application</span></a>`
      )
    )
  })

  // ---------------------------------------------------------------- //
  // RA-324 Applications tiles page                                    //
  //                                                                  //
  // AC04: applications render as tiles (not a table).                //
  // ---------------------------------------------------------------- //
  test('Renders applications as tiles, not the old table', async () => {
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    // Tiles container + one tile per application.
    expect(result).toContain('data-testid="applications-list"')
    expect(result).toContain('data-testid="application-tile"')
    // The old wide, horizontally-scrolling table is gone entirely.
    expect(result).not.toContain('data-testid="work-items-table"')
    expect(result).not.toContain('app-work-items__table-wrapper')
  })

  // RA-324 phase-2, re-ordered by RA-370: the "{Org} ({Org ID})" line now
  // precedes the "{Material} reaccreditation (Reprocessor)" title line, so
  // material leads the title and applicant type follows it.
  test('Renders the card title, applicant type, material and org line', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            payload: {
              material: 'plastic',
              organisationName: 'Acme Recycling',
              operatorOrganisationId: 'ORG-4242'
            }
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="application-card-title"')
    expect(result).toContain('data-testid="applicant-type">Reprocessor</span>')
    // Card shows the material DISPLAY LABEL, not the raw token.
    expect(result).toContain('data-testid="material">Plastic</span>')
    expect(result).not.toContain('data-testid="material">plastic</span>')
    expect(result).toContain('data-testid="application-org"')
    expect(result).toContain('data-testid="org-name">Acme Recycling</span>')
    expect(result).toContain('data-testid="org-id">ORG-4242</span>')
    // RA-370. The org line comes BEFORE the material/applicant-type title,
    // and within the title material comes before applicant type.
    expect(result.indexOf('data-testid="application-org"')).toBeLessThan(
      result.indexOf('data-testid="application-card-title"')
    )
    expect(result.indexOf('data-testid="material"')).toBeLessThan(
      result.indexOf('data-testid="applicant-type"')
    )
    // RA-324 prototype fix: the title is normal weight, not bold.
    expect(result).not.toContain(
      'govuk-!-font-weight-bold app-application-card__title'
    )
  })

  // RA-295 AC06. The registration number is part of the data displayed on
  // the Applications list. Note this is `registrationNumber` (EPR-xxxxxx) —
  // NOT the confusingly-similar `operatorRegistrationId` (reg-xxx).
  test('RA-295 AC06: renders the registration number on each card', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            payload: {
              registrationNumber: 'EPR-100999',
              operatorRegistrationId: 'reg-008'
            }
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="application-registration"')
    expect(result).toContain(
      'data-testid="registration-number">EPR-100999</span>'
    )
    // The similarly-named operator registration id must not leak in.
    expect(result).not.toContain(
      'data-testid="registration-number">reg-008</span>'
    )
  })

  test('RA-295 AC06: falls back to an em dash when the card has no registration number', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="registration-number">—</span>')
  })

  // RA-324 phase-2 (footer). Once the SLA clock has started the card shows an
  // "Assigned to / Due on" footer, with the absolute slaDueDate formatted to a
  // GDS date.
  test('Renders the Assigned to / Due on footer once the SLA clock has started', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            typeId: 'unknown-type',
            stateId: 'assessment-in-progress',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: 'frontend',
            assignedToName: 'Olga Officer',
            slaState: 'OnTrack',
            // January/February UK dates are GMT (UTC+0) so timezone-stable.
            slaDueDate: '2026-02-10T00:00:00Z',
            payload: { operatorOrganisationId: 'ORG-4242' }
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="application-card-footer"')
    expect(result).toContain('data-testid="assigned-to">Olga Officer</span>')
    expect(result).toContain('data-testid="due-on"')
    expect(result).toContain('10 February 2026')
    // RA-370 AC02. Once the state has moved past duly-made the assessment has
    // started, so "Submitted on" is hidden.
    expect(result).not.toContain('data-testid="submitted-on"')
    // RA-324 prototype fix: "Assigned to:" / "Due on:" labels are bold (their
    // own span), the values are not individually bolded.
    expect(result).toContain(
      '<span class="app-application-card__meta-label">Assigned to:</span>'
    )
    expect(result).toContain(
      '<span class="app-application-card__meta-label">Due on:</span>'
    )
  })

  // RA-370 AC02/AC04/AC05. A "Not started" card (no SLA clock) still gets a
  // footer: "Submitted on" (the assessment has not started) and "Assigned to"
  // — but NOT "Due on", which stays gated on the clock. This replaces the
  // RA-324 behaviour where the whole footer was hidden pre-clock.
  test('Renders Submitted on and Assigned to, but no Due on, before the SLA clock starts', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000000',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="application-card-footer"')
    // AC03. GDS date format — "15 January 2026", no time component.
    expect(result).toContain(
      'data-testid="submitted-on">15 January 2026</span>'
    )
    expect(result).toContain(
      '<span class="app-application-card__meta-label">Submitted on:</span>'
    )
    // AC04. Assigned to renders even though the clock has not started.
    expect(result).toContain('data-testid="assigned-to">Unassigned</span>')
    // AC05. Due on stays gated on the SLA clock.
    expect(result).not.toContain('data-testid="due-on"')
    // AC01. Field order within the footer: Submitted on, then Assigned to.
    expect(result.indexOf('data-testid="submitted-on"')).toBeLessThan(
      result.indexOf('data-testid="assigned-to"')
    )
  })

  // RA-370 AC04. The assignee's display name shows when the case is held by an
  // officer, on a card whose SLA clock has NOT started — the case that used to
  // render nothing at all.
  test('Shows the officer name for an assigned card before the SLA clock starts', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000001',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            assignedToName: 'Olga Officer',
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="assigned-to">Olga Officer</span>')
    expect(result).toContain('data-testid="submitted-on"')
  })

  // RA-370 AC04. "Unassigned" also shows once the clock HAS started, i.e. the
  // assignment fallback is independent of the SLA gate.
  test('Shows Unassigned once the SLA clock has started and nobody holds the case', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000002',
            typeId: 'unknown-type',
            stateId: 'assessment-in-progress',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            slaState: 'OnTrack',
            slaDueDate: '2026-02-10T00:00:00Z',
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="assigned-to">Unassigned</span>')
    expect(result).toContain('data-testid="due-on">10 February 2026</span>')
    expect(result).not.toContain('data-testid="submitted-on"')
  })

  // RA-370 AC02 (regression). THE case this rule exists for:
  // ReAccreditationDulyMadeSnapshotMigration back-fills items into 'duly-made'
  // AND stamps an SLA clock in the same write, so a pre-assessment item can
  // carry a running clock. "Submitted on" must still show — gating it on the
  // clock would wrongly hide it for exactly this population. Both dates
  // render, which is intended: the clock genuinely is running.
  test('RA-370: shows Submitted on for a migrated duly-made item that already has an SLA clock', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'bbbbbbbb-0000-0000-0000-000000000000',
            typeId: 'unknown-type',
            stateId: 'duly-made',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            slaState: 'OnTrack',
            slaDueDate: '2026-02-10T00:00:00Z',
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain(
      'data-testid="submitted-on">15 January 2026</span>'
    )
    // The clock is running, so Due on renders too — the two dates are gated
    // independently and are NOT mutually exclusive.
    expect(result).toContain('data-testid="due-on">10 February 2026</span>')
    // Footer order stays Submitted on -> Assigned to -> Due on even when all
    // three render.
    expect(result.indexOf('data-testid="submitted-on"')).toBeLessThan(
      result.indexOf('data-testid="assigned-to"')
    )
    expect(result.indexOf('data-testid="assigned-to"')).toBeLessThan(
      result.indexOf('data-testid="due-on"')
    )
  })

  // RA-370 AC02. A duly-made item with no clock yet (the forward path before
  // payment is recorded) shows Submitted on and no Due on.
  test('RA-370: shows Submitted on for a duly-made item with no SLA clock', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'bbbbbbbb-0000-0000-0000-000000000001',
            typeId: 'unknown-type',
            stateId: 'duly-made',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain(
      'data-testid="submitted-on">15 January 2026</span>'
    )
    expect(result).not.toContain('data-testid="due-on"')
  })

  // RA-370 AC02. Every state past duly-made counts as assessment-started and
  // hides Submitted on — including 'queried' and 'updated', which are reachable
  // from any pre-decision state and so cannot be proven pre-assessment.
  test.each([
    'assessment-in-progress',
    'awaiting-decision',
    'queried',
    'updated',
    'approved',
    'rejected',
    'withdrawn'
  ])('RA-370: hides Submitted on in state %s', async (stateId) => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'bbbbbbbb-0000-0000-0000-000000000002',
            typeId: 'unknown-type',
            stateId,
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).not.toContain('data-testid="submitted-on"')
    // No clock on these fixtures, so no Due on either — the "neither date"
    // case. It is not reachable on the forward path (the clock is stamped on
    // the way into assessment) but legacy data can look like this, and showing
    // no date beats inventing one. The footer and Assigned to still render.
    expect(result).not.toContain('data-testid="due-on"')
    expect(result).toContain('data-testid="application-card-footer"')
    expect(result).toContain('data-testid="assigned-to">Unassigned</span>')
  })

  // RA-370 AC03. The submission date arrives either as a plain ISO string or
  // as the Mongo `{ $date }` wrapper; both must render the same GDS date.
  test('Unwraps a Mongo $date submittedAt for Submitted on', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000003',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: { $date: '2026-01-15T10:00:00Z' },
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain(
      'data-testid="submitted-on">15 January 2026</span>'
    )
  })

  // RA-370 AC03 (defensive). A missing submittedAt renders an em dash rather
  // than a blank cell or "Invalid Date".
  test('Renders an em dash for Submitted on when submittedAt is missing', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000004',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: null,
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="submitted-on">—</span>')
    expect(result).not.toContain('Invalid Date')
  })

  // RA-370 AC03 (defensive). A present-but-unparseable submittedAt must not
  // leak "Invalid Date" — `formatDateGds` yields '' and the template falls
  // through to the em dash.
  test('Renders an em dash for Submitted on when submittedAt is unparseable', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000005',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: 'not-a-date',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="submitted-on">—</span>')
    expect(result).not.toContain('Invalid Date')
  })

  // RA-370 AC01. The whole ordered field list on a single card, asserted as
  // one sequence: ref link, org name, org id, registration number, material,
  // applicant type, submitted on, assigned to. (Due on is excluded here — it
  // is mutually exclusive with submitted on; the started-clock ordering is
  // covered by the footer test above.)
  test('RA-370 AC01: renders every card field in the specified order', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000006',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-01-15T10:00:00Z',
            submittedBy: null,
            payload: {
              applicationReference: 'RA-100',
              organisationName: 'Acme Recycling',
              operatorOrganisationId: 'ORG-4242',
              registrationNumber: 'EPR-100999',
              material: 'plastic'
            }
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    const order = [
      'data-testid="work-item-link-aaaaaaaa-0000-0000-0000-000000000006"',
      'data-testid="org-name"',
      'data-testid="org-id"',
      'data-testid="registration-number"',
      'data-testid="material"',
      'data-testid="applicant-type"',
      'data-testid="submitted-on"',
      'data-testid="assigned-to"'
    ].map((hook) => {
      const at = result.indexOf(hook)
      expect(at, `missing card field ${hook}`).toBeGreaterThan(-1)
      return at
    })

    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1])
    }
  })

  // RA-324 phase-2. When the SLA clock has started but slaDueDate is absent
  // (defensive), the Due on cell renders an em dash — never "Invalid Date".
  test('Renders an em dash for Due on when slaDueDate is missing', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'eeeeeeee-1111-1111-1111-111111111111',
            typeId: 'unknown-type',
            stateId: 'assessment-in-progress',
            submittedAt: null,
            submittedBy: null,
            slaState: 'OnTrack',
            slaDueDate: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(result).toContain('data-testid="application-card-footer"')
    expect(result).toContain('data-testid="due-on">—</span>')
    expect(result).not.toContain('Invalid Date')
  })

  test('Renders in the constrained width with filter sidebar before the cards', async () => {
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'aaaaaaaa-1111-1111-1111-111111111111',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    // RA-324 width fix: the page no longer widens the container to 1600 px —
    // it sits in the default GOV.UK width container and never scrolls sideways.
    expect(result).not.toContain('app-width-container--wide')
    // Filter sidebar (one-quarter) + tiles column (three-quarters) retained.
    expect(result).toContain('govuk-grid-column-one-quarter')
    expect(result).toContain('govuk-grid-column-three-quarters')
    // Filter form must appear before the tiles in document order.
    const filterIdx = result.indexOf('data-testid="work-items-filter-form"')
    const tilesIdx = result.indexOf('data-testid="applications-list"')
    expect(filterIdx).toBeGreaterThan(-1)
    expect(tilesIdx).toBeGreaterThan(filterIdx)
  })

  // RA-324 (AC08). Every registered state id maps to its contract badge
  // colour, and an unknown id falls back to the neutral grey tag. The colours
  // come from the shared state-badge map so the list and the detail page stay
  // consistent.
  test('Maps each registered state id to its RA-324 GOV.UK tag colour', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Not started' },
      states: [
        { id: 'submitted', displayName: 'Not started' },
        { id: 'duly-made', displayName: 'Duly made' },
        { id: 'assessment-in-progress', displayName: 'Updated' },
        { id: 'awaiting-decision', displayName: 'Awaiting decision' },
        { id: 'queried', displayName: 'Queried' },
        { id: 'updated', displayName: 'Updated' },
        { id: 'approved', displayName: 'Granted' },
        { id: 'rejected', displayName: 'Refused' },
        { id: 'withdrawn', displayName: 'Withdrawn' }
      ],
      getTasksForState: () => []
    })
    const states = [
      { stateId: 'submitted', cls: 'govuk-tag--grey' },
      { stateId: 'duly-made', cls: 'govuk-tag--purple' },
      { stateId: 'assessment-in-progress', cls: 'govuk-tag--blue' },
      { stateId: 'awaiting-decision', cls: 'govuk-tag--light-blue' },
      { stateId: 'queried', cls: 'govuk-tag--yellow' },
      { stateId: 'updated', cls: 'govuk-tag--turquoise' },
      { stateId: 'approved', cls: 'govuk-tag--green' },
      { stateId: 'rejected', cls: 'govuk-tag--red' },
      { stateId: 'withdrawn', cls: 'govuk-tag--grey' },
      { stateId: 'mystery', cls: 'govuk-tag--grey' }
    ]
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: states.map((s, i) => ({
          id: `00000000-0000-0000-0000-00000000000${i}`,
          typeId: 're-accreditation',
          stateId: s.stateId,
          submittedAt: '2026-04-27T10:00:00Z',
          submittedBy: 'frontend',
          payload: {}
        })),
        totalCount: states.length
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    // Each state's badge renders with its contract colour on its own tile.
    for (const [i, s] of states.entries()) {
      const id = `00000000-0000-0000-0000-00000000000${i}`
      const badgeIdx = result.indexOf(`data-testid="work-item-state-tag-${id}"`)
      expect(badgeIdx).toBeGreaterThan(-1)
      const badgeMarkup = result.slice(badgeIdx - 120, badgeIdx)
      expect(badgeMarkup).toContain(s.cls)
    }
    // The retired orange (RA-291 queried) colour is gone.
    expect(result).not.toContain('govuk-tag--orange')
  })

  test('Falls back to the raw state id label when no module is registered', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            typeId: 'unknown-type',
            stateId: 'mystery',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    // Unknown state id falls back to the raw id as the badge label.
    expect(result).toEqual(expect.stringContaining('mystery'))
    // Empty org name / material render as em dashes.
    expect(result).toEqual(expect.stringContaining('—'))
  })

  test('Renders an error banner when the backend cannot be reached', async () => {
    getWorkItems.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('Could not reach the backend')
    )
    expect(result).toEqual(expect.stringContaining('ECONNREFUSED'))
  })

  // RA-324 phase-2. The new filter params (type, status group, material, sort,
  // organisation) forward to the backend. The "Updated" status group expands
  // to BOTH backend state ids.
  test('Forwards type, status, material, sort and organisation filters to the backend', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Not started' },
      states: [
        { id: 'submitted', displayName: 'Not started' },
        { id: 'assessment-in-progress', displayName: 'Updated' },
        { id: 'updated', displayName: 'Updated' },
        { id: 'approved', displayName: 'Granted', isTerminal: true }
      ],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(
      emptyPage({ totalCount: 0, page: 1, pageSize: 20 })
    )

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items?typeId=re-accreditation&typeId=exporter&status=updated&status=approved&material=plastic&material=glass-remelt&sort=due-date&organisation=acme&filtersApplied=1'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        // Exporter is a placeholder typeId with no data — still forwarded so
        // it returns zero results.
        typeIds: ['re-accreditation', 'exporter'],
        // "Updated" group expands to both ids; "Granted" -> approved.
        stateIds: ['assessment-in-progress', 'updated', 'approved'],
        // RA-299 AC05: the UI filter value 'glass-remelt' maps to the real
        // backend 'glass' token (see materials.js — no data can currently
        // distinguish remelt/other).
        materials: ['plastic', 'glass'],
        sort: 'due-date',
        organisation: 'acme',
        pageSize: 20
      })
    )
  })

  // RA-299 AC01/15. "Application type" is a second, independent filter
  // section from "Applicant type" (typeId) above; both merge into the same
  // backend typeIds query.
  test('Forwards the applicationType filter, merged with typeId, into a single typeIds list', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?typeId=re-accreditation&applicationType=accreditation&applicationType=registration-application&filtersApplied=1'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        typeIds: [
          're-accreditation',
          'accreditation',
          'registration-application'
        ]
      })
    )
  })

  test('De-dupes typeId and applicationType when both select re-accreditation', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?typeId=re-accreditation&applicationType=re-accreditation&filtersApplied=1'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ typeIds: ['re-accreditation'] })
    )
  })

  test('Drops unknown applicationType values', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?applicationType=ghost&filtersApplied=1'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ typeIds: [] })
    )
  })

  test('Drops unknown type and state filter values', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?typeId=ghost&stateId=mystery&search=&page=0'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        typeIds: [],
        stateIds: [],
        search: '',
        page: 1,
        pageSize: 20
      })
    )
  })

  test('Renders a pagination block when there is more than one page', async () => {
    clearWorkItemRegistry()
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 45,
        page: 2,
        pageSize: 20
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items?page=2'
    })

    // govuk-pagination renders a <nav class="govuk-pagination">.
    expect(result).toEqual(expect.stringContaining('govuk-pagination'))
    // Previous and next links preserve the page parameter.
    expect(result).toEqual(expect.stringContaining('href="/work-items"'))
    expect(result).toEqual(expect.stringContaining('href="/work-items?page=3"'))
    // RA-324 phase-2 (prototype). Just the item range + total, no "page X of
    // Y" or filter recap. rangeStart = (page-1)*pageSize+1 = 21; rangeEnd
    // reflects the actual rendered item count (1 mocked item) = 21. Bold per
    // the prototype.
    expect(result).toEqual(
      expect.stringContaining('<strong>Showing 21-21 of 45</strong>')
    )
  })

  test('Shows a filtered empty-state message when filters are active but nothing matches', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(emptyPage())

    const { result } = await server.inject({
      method: 'GET',
      url: '/work-items?typeId=re-accreditation'
    })

    expect(result).toEqual(
      expect.stringContaining('No work items match your filters.')
    )
    // RA-324 phase-2. The only "clear" affordance is the "Clear all filters"
    // link in the Active filters block — no duplicate link below the sections.
    expect(result).toEqual(expect.stringContaining('Clear all filters'))
  })

  test('Translates assigneeMode=mine into the signed-in user id', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=mine'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        // Default test user is the standard caseworker stub user.
        assigneeId: 'test-standard-id',
        unassigned: false
      })
    )
  })

  test('Translates assigneeMode=unassigned into unassigned=true', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=unassigned'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: null, unassigned: true })
    )
  })

  test('Translates assigneeMode=user with assigneeUserId into a backend assigneeId filter', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=user&assigneeUserId=u-9'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: 'u-9', unassigned: false })
    )
  })

  test('Drops unknown assigneeMode values silently', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({
      method: 'GET',
      url: '/work-items?assigneeMode=ghost'
    })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: null, unassigned: false })
    )
  })

  test('Forwards the signed-in user to the backend client so identity headers are sent', async () => {
    getWorkItems.mockResolvedValue(emptyPage())

    await server.inject({ method: 'GET', url: '/work-items' })

    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: expect.any(String) })
      })
    )
  })

  // ---------------------------------------------------------------- //
  // XSS regression — epr-6fi.                                         //
  //                                                                  //
  // Nunjucks autoescape only kicks in for `{{ … }}` interpolations,  //
  // not for govuk macro `html:` parameters. The list page used to    //
  // concatenate the work-item id into a link's href / text and the   //
  // backend error message into the notification banner — both raw —  //
  // which let a malicious id or backend payload inject script tags.  //
  // ---------------------------------------------------------------- //
  test('Escapes work-item ids when rendering the list to prevent XSS', async () => {
    clearWorkItemRegistry()
    const malicious = '<script>alert(1)</script>'
    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: malicious,
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toContain(malicious)
    expect(result).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    // href is URL-encoded, not just HTML-escaped, so the angle brackets
    // are %3C / %3E rather than &lt; / &gt;.
    expect(result).toContain(
      'href="/work-items/%3Cscript%3Ealert(1)%3C%2Fscript%3E"'
    )
  })

  test('Escapes the backend error message when the list banner renders', async () => {
    const malicious = '<img src=x onerror="alert(1)">'
    getWorkItems.mockResolvedValue({ ok: false, error: malicious })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('Could not reach the backend')
    expect(result).not.toContain(malicious)
    expect(result).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  describe('RA-127 create-work-item button', () => {
    const flagKey = 'featureFlags.workItemCreationEnabled'
    let originalFlag

    beforeEach(() => {
      originalFlag = config.get(flagKey)
      getWorkItems.mockResolvedValue(emptyPage())
    })

    afterEach(() => {
      config.set(flagKey, originalFlag)
    })

    test('renders the button when the flag is on', async () => {
      config.set(flagKey, true)
      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })
      expect(result).toEqual(
        expect.stringContaining('data-testid="work-items-create-link"')
      )
      // It's a govukButton styled as a link (href-based), not a plain
      // <a> — must carry govuk-frontend's own role/data-module/
      // draggable attributes or keyboard/screen-reader support regress.
      // See action-link/macro.njk's `variant: 'button'` path.
      expect(result).toMatch(
        /<a(?=[^>]*data-testid="work-items-create-link")(?=[^>]*role="button")(?=[^>]*draggable="false")(?=[^>]*data-module="govuk-button")[^>]*>/
      )
    })

    // RA-335: a read-only support user still gets a govuk-button-shaped
    // inert span, not a plain link-shaped one.
    test('renders the button as a disabled govuk-button-shaped span for a support user', async () => {
      config.set(flagKey, true)
      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items',
        headers: { 'x-test-user-role': 'support-readonly' }
      })
      expect(result).toMatch(
        /<span(?=[^>]*data-testid="work-items-create-link")(?=[^>]*class="govuk-button[^"]*app-action-link--disabled)/
      )
    })

    test('hides the button when the flag is off', async () => {
      config.set(flagKey, false)
      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="work-items-create-link"')
      )
    })
  })

  // ---------------------------------------------------------------- //
  // RA-125 — Nation filter                                            //
  // ---------------------------------------------------------------- //
  describe('RA-125 nation filter', () => {
    test('Forwards nation query params to the backend', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?nation=England&nation=Scotland'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['England', 'Scotland'] })
      )
    })

    test('Drops invalid nation values', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?nation=England&nation=Atlantis'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['England'] })
      )
    })

    test('Defaults to user nation role when user has exactly one nation role', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items',
        headers: { 'x-test-user-role': 'nation-scotland' }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['Scotland'] })
      )
    })

    test('No default nation when user has no nation roles', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      // Default assign user has no nation roles.
      await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: [] })
      )
    })

    test('Explicit query param overrides role-based nation default', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?nation=Wales',
        headers: { 'x-test-user-role': 'nation-england' }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['Wales'] })
      )
    })

    test('Nation checkboxes appear with plain nation names', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).toContain('filter-nation')
      // RA-324 phase-2: the prototype uses plain nation names (not regulator
      // body names) and the section is labelled "Nation".
      expect(result).toContain('England')
      expect(result).toContain('Northern Ireland')
      expect(result).toContain('Scotland')
      expect(result).toContain('Wales')
      expect(result).toContain('data-testid="filter-section-nation"')
      // The old regulator body names are gone.
      expect(result).not.toContain('Environment Agency (EA)')
    })

    test('Nation checkboxes reflect the active filter', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?nation=Wales'
      })

      // The Wales checkbox must actually carry the checked attribute, and
      // the unchecked nations must not. Match on the name="nation" inputs
      // emitted by the govukCheckboxes macro.
      const inputRe = /<input[^>]*name="nation"[^>]*>/g
      const inputs = result.match(inputRe) ?? []
      expect(inputs).toHaveLength(4)
      const walesInput = inputs.find((i) => i.includes('value="Wales"'))
      const englandInput = inputs.find((i) => i.includes('value="England"'))
      expect(walesInput).toMatch(/\bchecked\b/)
      expect(englandInput).not.toMatch(/\bchecked\b/)
    })

    test('Form submission with no nation boxes ticked clears the role-based default', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      // Nation-england user submits the filter form (filtersApplied=1) with
      // no nation boxes ticked: they want to see all nations, not be locked
      // back into England by the default-resolution path.
      await server.inject({
        method: 'GET',
        url: '/work-items?filtersApplied=1',
        headers: { 'x-test-user-role': 'nation-england' }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: [] })
      )
    })

    test('Bare GET still applies the role-based nation default', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      // No filtersApplied marker on the URL — this is a fresh navigation,
      // so the regulator's own queue should still be pre-selected.
      await server.inject({
        method: 'GET',
        url: '/work-items',
        headers: { 'x-test-user-role': 'nation-england' }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ nations: ['England'] })
      )
    })

    test('Pagination links preserve filtersApplied so defaults do not silently re-apply', async () => {
      // Pagination is only rendered when at least one item is present, so
      // register a minimal type and return one item across multiple pages.
      clearWorkItemRegistry()
      registerWorkItemType({
        id: 're-accreditation',
        displayName: 'Re-accreditation',
        initialState: { id: 'submitted', displayName: 'Submitted' },
        states: [{ id: 'submitted', displayName: 'Submitted' }],
        getTasksForState: () => []
      })
      getWorkItems.mockResolvedValue({
        ok: true,
        items: [
          {
            id: '44444444-4444-4444-4444-444444444444',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 100,
        page: 1,
        pageSize: 20
      })

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?filtersApplied=1',
        headers: { 'x-test-user-role': 'nation-england' }
      })

      // The 'next' link (and any numbered page links) must carry the
      // filtersApplied marker so paginating doesn't snap back to the
      // role-based nation default. Allow either '&' or HTML-escaped '&amp;'.
      expect(result).toMatch(/href="[^"]*filtersApplied=1[^"]*"/)
    })

    test('hasFilters is true when nations filter is active', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?nation=England'
      })

      // The "Clear all filters" link is only rendered when hasFilters=true
      // (via the Active filters block).
      expect(result).toContain('Clear all filters')
    })
  })

  // ---------------------------------------------------------------- //
  // RA-136 — Archive filter                                           //
  // ---------------------------------------------------------------- //
  describe('RA-136 archive filter', () => {
    test('Forwards includeArchived=true to the backend when the query param is set', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ includeArchived: true })
      )
    })

    test('Sends includeArchived=false when the query param is absent', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({ method: 'GET', url: '/work-items' })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ includeArchived: false })
      )
    })

    test('hasFilters is true when includeArchived is set', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true'
      })

      expect(result).toContain('Clear all filters')
    })

    test('Renders archivedAt from extended-JSON $date shape as a human-readable date', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              typeId: 'unknown-type',
              stateId: 'approved',
              submittedAt: '2026-04-01T10:00:00Z',
              submittedBy: null,
              payload: { archivedAt: { $date: '2026-05-01T12:00:00Z' } }
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true'
      })

      expect(result).toContain('1 May 2026')
      expect(result).toContain(
        'data-testid="work-item-archived-at-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"'
      )
    })

    test('Renders archivedAt from a plain ISO-8601 string as a human-readable date', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
              typeId: 'unknown-type',
              stateId: 'approved',
              submittedAt: '2026-04-01T10:00:00Z',
              submittedBy: null,
              payload: { archivedAt: '2026-05-01T12:00:00Z' }
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true'
      })

      expect(result).toContain('1 May 2026')
      expect(result).toContain(
        'data-testid="work-item-archived-at-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"'
      )
    })

    test('Renders an em-dash for items with no archivedAt value', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
              typeId: 'unknown-type',
              stateId: 'submitted',
              submittedAt: '2026-04-01T10:00:00Z',
              submittedBy: null,
              payload: {}
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      // The Nunjucks `item.archivedAt or "—"` renders a dash when null.
      expect(result).toContain('—')
    })

    test('Ignores an unparseable archivedAt (no archived line rendered)', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: 'cccccccc-dddd-dddd-dddd-dddddddddddd',
              typeId: 'unknown-type',
              stateId: 'submitted',
              submittedAt: '2026-04-01T10:00:00Z',
              submittedBy: null,
              payload: { archivedAt: 'not-a-real-date' }
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true'
      })

      // formatArchivedAt returns null for an unparseable value, so the card
      // renders no archived line at all (never "Invalid Date").
      expect(result).not.toContain('data-testid="work-item-archived-at-')
      expect(result).not.toContain('Invalid Date')
    })

    test('Pagination links preserve includeArchived so the filter survives page changes', async () => {
      clearWorkItemRegistry()
      registerWorkItemType({
        id: 're-accreditation',
        displayName: 'Re-accreditation',
        initialState: { id: 'submitted', displayName: 'Submitted' },
        states: [{ id: 'submitted', displayName: 'Submitted' }],
        getTasksForState: () => []
      })
      getWorkItems.mockResolvedValue({
        ok: true,
        items: [
          {
            id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-04-01T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 100,
        page: 1,
        pageSize: 20
      })

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true&filtersApplied=1'
      })

      expect(result).toMatch(/href="[^"]*includeArchived=true[^"]*"/)
    })
  })

  // Consumer contract test: this payload is a literal copy of the JSON
  // built by HttpCaseWorkingApiAdapter.BuildPayload in
  // epr-register-enrol-backend (the real operator submission), not a
  // hand-picked field. If the adapter's `material` field name ever drifts
  // from what decorate() reads here, this test fails instead of the
  // Material column silently going blank in production — which is exactly
  // what happened when the adapter sent `materialsHandled` while this table
  // read `payload.material`. Keep this fixture in sync with BuildPayload.
  test('Renders the material column from a real operator-backend submission payload', async () => {
    clearWorkItemRegistry()
    registerWorkItemType({
      id: 're-accreditation',
      displayName: 'Re-accreditation',
      initialState: { id: 'submitted', displayName: 'Submitted' },
      states: [{ id: 'submitted', displayName: 'Submitted' }],
      getTasksForState: () => []
    })

    getWorkItems.mockResolvedValue(
      emptyPage({
        items: [
          {
            id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            typeId: 're-accreditation',
            stateId: 'submitted',
            submittedAt: '2026-05-01T10:00:00Z',
            submittedBy: 'operator-fe',
            payload: {
              organisationName: 'Acme Recycling Ltd',
              registrationNumber: 'EPR-100023',
              material: 'plastic',
              accreditationYear: 2026,
              previousAccreditationYear: 2025,
              complianceIssuesReported: 0,
              siteAddress: '123 High Street, London, SW1A 1AA',
              siteAddressPostcode: 'SW1A 1AA',
              operatorApplicationId: 'app-001',
              operatorOrganisationId: '12345',
              operatorRegistrationId: 'reg-001',
              operatorEmail: 'jane@example.com'
            }
          }
        ],
        totalCount: 1
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/work-items'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Acme Recycling Ltd'))
    // Card renders the material display label, not the raw 'plastic' token.
    expect(result).toEqual(expect.stringContaining('Plastic'))
  })

  // ---------------------------------------------------------------- //
  // RA-324 phase-2 filter sidebar: collapsible sections, active       //
  // filters block, sort, material, status grouping, organisation.     //
  // ---------------------------------------------------------------- //
  describe('RA-324 phase-2 filter sidebar', () => {
    test('Renders the collapsible filter sections with the AC labels', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      for (const key of [
        'sort',
        'type',
        'nation',
        'material',
        'assignment',
        'status',
        'organisation',
        'archived'
      ]) {
        expect(result).toContain(`data-testid="filter-section-${key}"`)
        expect(result).toContain(`data-testid="filter-section-${key}-toggle"`)
      }
      // Archived toggle keeps its phase-1 testid + includeArchived param.
      expect(result).toContain(
        'data-testid="work-items-filter-include-archived"'
      )
      // Sort options carry per-option testids.
      expect(result).toContain('data-testid="filter-sort-due-date"')
      expect(result).toContain('data-testid="filter-sort-organisation"')
      expect(result).toContain('data-testid="filter-sort-status"')
      // Type labels (Reprocessor enabled + Exporter placeholder).
      expect(result).toContain('Reprocessor reaccreditation')
      expect(result).toContain('Exporter reaccreditation')
      // Material labels.
      expect(result).toContain('Fibre-based composite material')
      expect(result).toContain('Paper or board')
      // Status uses the AC06 labels, not the raw workflow names.
      expect(result).toContain('Not started')
      expect(result).toContain('Granted')
      expect(result).toContain('Refused')
      // Combined organisation input replaces the old three inputs.
      expect(result).toContain('data-testid="work-items-filter-org-search"')
      expect(result).not.toContain(
        'data-testid="work-items-filter-registration-id"'
      )
      expect(result).not.toContain('data-testid="work-items-filter-org-name"')
      // RA-324 prototype fixes: no separate "Filter" heading above the
      // sections (they start directly after Active filters / the form), and
      // no duplicate "Clear filters" link at the bottom of the sidebar — the
      // only clear affordance is "Clear all filters" in the Active filters
      // block (only rendered when a filter is active).
      expect(result).not.toContain('>Filter</h2>')
      expect(result).not.toContain('data-testid="work-items-filter-clear"')
      expect(result).toContain('data-testid="work-items-filter-apply"')
    })

    test('Shows removable active-filter tags and a clear-all link', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?typeId=re-accreditation&nation=England&material=plastic&status=updated&organisation=acme&assigneeMode=unassigned&sort=due-date&filtersApplied=1'
      })

      expect(result).toContain('data-testid="active-filters"')
      expect(result).toContain('data-testid="active-filter-remove"')
      expect(result).toContain('data-testid="active-filters-clear"')
      // RA-324 prototype fix: chips show ONLY the value — no category prefix
      // — except Sort, which keeps its "Sorted by: " prefix.
      expect(result).toContain(
        'data-testid="active-filter-label">Reprocessor reaccreditation</span>'
      )
      expect(result).toContain(
        'data-testid="active-filter-label">England</span>'
      )
      expect(result).toContain(
        'data-testid="active-filter-label">Plastic</span>'
      )
      expect(result).toContain(
        'data-testid="active-filter-label">Updated</span>'
      )
      expect(result).toContain('data-testid="active-filter-label">acme</span>')
      expect(result).toContain(
        'data-testid="active-filter-label">Unassigned</span>'
      )
      expect(result).toContain('Sorted by: Due date')
      // None of the non-sort chips carry a category prefix.
      expect(result).not.toContain('Type: Reprocessor reaccreditation')
      expect(result).not.toContain('Nation: England')
      expect(result).not.toContain('Material: Plastic')
      expect(result).not.toContain('Status: Updated')
      expect(result).not.toContain('Organisation: acme')
      expect(result).not.toContain('Assignment: Unassigned')
      // The section with a selection is expanded and shows a count.
      expect(result).toContain('(1 selected)')
      // Clear-all points at the explicit reset (RA-299 AC12) rather than a
      // bare /work-items, which would restore the session-persisted filters.
      expect(result).toContain(
        'href="/work-items?clear=1" data-testid="active-filters-clear"'
      )
    })

    test('Each active-filter removal href drops only that filter', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?nation=England&material=plastic&filtersApplied=1'
      })

      // Removing Nation keeps material; removing Material keeps nation.
      expect(result).toContain(
        'href="/work-items?material=plastic&amp;filtersApplied=1"'
      )
      expect(result).toContain(
        'href="/work-items?nation=England&amp;filtersApplied=1"'
      )
    })

    // Guards against a withoutFilter regression that drops a whole dimension
    // rather than the single value: with REPEATED tokens, removing one chip
    // must keep the other value of the SAME dimension.
    test('Removing one repeated-token chip keeps the other value of that dimension', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?material=plastic&material=glass-remelt&status=updated&status=approved&filtersApplied=1'
      })

      // Removing the "plastic" material chip keeps material=glass-remelt
      // (and the other status pair intact), and vice versa.
      expect(result).toContain(
        'href="/work-items?status=updated&amp;status=approved&amp;material=glass-remelt&amp;filtersApplied=1"'
      )
      expect(result).toContain(
        'href="/work-items?status=updated&amp;status=approved&amp;material=plastic&amp;filtersApplied=1"'
      )
      // Removing the "updated" status chip keeps status=approved (+ both
      // materials), and vice versa.
      expect(result).toContain(
        'href="/work-items?status=approved&amp;material=plastic&amp;material=glass-remelt&amp;filtersApplied=1"'
      )
      expect(result).toContain(
        'href="/work-items?status=updated&amp;material=plastic&amp;material=glass-remelt&amp;filtersApplied=1"'
      )
    })

    test('The sort chip removal drops sort= and the archived chip drops includeArchived', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?sort=due-date&includeArchived=true&filtersApplied=1'
      })

      // Removing "Sorted by" leaves only the archived filter (no sort=).
      expect(result).toContain(
        'href="/work-items?filtersApplied=1&amp;includeArchived=true"'
      )
      // Removing "Archived" leaves only the sort (no includeArchived).
      expect(result).toContain(
        'href="/work-items?sort=due-date&amp;filtersApplied=1"'
      )
    })

    // De-dup material tokens AFTER lower-casing: ?material=Plastic&material=plastic
    // must collapse to a single token, one chip, and one backend value.
    test('De-duplicates material tokens case-insensitively', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?material=Plastic&material=plastic&filtersApplied=1'
      })

      // Exactly one Material chip (one removal link for material). Chips
      // carry no category prefix, so match on the bare value.
      const chipCount = (
        result.match(/data-testid="active-filter-label">Plastic<\/span>/g) ?? []
      ).length
      expect(chipCount).toBe(1)
      // Backend receives a single 'plastic' token.
      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ materials: ['plastic'] })
      )
    })

    test('The specific-officer assignment chip shows the officer name', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?assigneeMode=user&assigneeUserId=stub-caseworker-2&filtersApplied=1'
      })

      // RA-324 prototype fix: no "Assignment: " prefix — just the value.
      expect(result).toContain(
        'data-testid="active-filter-label">Stub Caseworker Two</span>'
      )
      expect(result).not.toContain('Assignment: Stub Caseworker Two')
    })

    test('Shows a "Your applications" chip for the mine assignment filter', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?assigneeMode=mine&filtersApplied=1'
      })

      expect(result).toContain(
        'data-testid="active-filter-label">Your applications</span>'
      )
      expect(result).not.toContain('Assignment: Your applications')
    })

    test('Falls back to the raw id when the officer is not in the directory', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?assigneeMode=user&assigneeUserId=ghost-officer&filtersApplied=1'
      })

      expect(result).toContain(
        'data-testid="active-filter-label">ghost-officer</span>'
      )
      expect(result).not.toContain('Assignment: ghost-officer')
    })

    test('Removal links preserve the specific-officer, search and organisation filters', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?nation=England&assigneeMode=user&assigneeUserId=stub-caseworker-2&search=widget&organisation=acme&filtersApplied=1'
      })

      // The nation chip's removal href carries every other active filter.
      expect(result).toContain('assigneeMode=user')
      expect(result).toContain('assigneeUserId=stub-caseworker-2')
      expect(result).toContain('search=widget')
      expect(result).toContain('organisation=acme')
    })

    test('Renders an em dash for Due on when slaDueDate is an unexpected shape', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: 'cccccccc-2222-2222-2222-222222222222',
              typeId: 'unknown-type',
              stateId: 'assessment-in-progress',
              submittedAt: null,
              submittedBy: null,
              slaState: 'OnTrack',
              slaDueDate: { notADate: true },
              payload: {}
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).toContain('data-testid="due-on">—</span>')
    })

    test('No active-filters block or clear link when nothing is filtered', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?filtersApplied=1'
      })

      expect(result).not.toContain('data-testid="active-filters"')
      expect(result).not.toContain('data-testid="work-items-filter-clear"')
    })

    // RA-324 prototype fix: the results count is just the item range + total
    // ("Showing 1-10 of 277") — the filter/sort recap that used to be
    // appended is gone; the Active filters chips are the single source of
    // truth for "what's applied".
    test('The results summary is just the range and total, with no filter recap', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: '99999999-9999-9999-9999-999999999999',
              typeId: 'unknown-type',
              stateId: 'submitted',
              submittedAt: '2026-04-27T10:00:00Z',
              submittedBy: null,
              payload: {}
            }
          ],
          totalCount: 1,
          page: 1,
          pageSize: 20
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?material=plastic&status=updated&sort=organisation&filtersApplied=1'
      })

      expect(result).toContain('data-testid="work-items-summary"')
      // Bold per the prototype.
      expect(result).toContain('<strong>Showing 1-1 of 1</strong>')
      // No filter/sort recap leaks into the summary text.
      expect(result).not.toContain('material: Plastic')
      expect(result).not.toContain('status: Updated')
      expect(result).not.toContain('sorted by Organisation')
      expect(result).not.toContain('Showing page')
    })

    test('Archived toggle appears as a removable active-filter chip', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: '88888888-8888-8888-8888-888888888888',
              typeId: 'unknown-type',
              stateId: 'submitted',
              submittedAt: '2026-04-27T10:00:00Z',
              submittedBy: null,
              payload: {}
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?includeArchived=true&filtersApplied=1'
      })

      // Section is expanded (has a selection) and the toggle is checked.
      expect(result).toContain('data-testid="filter-section-archived"')
      expect(result).toContain(
        'data-testid="work-items-filter-include-archived"'
      )
      // Removable active-filter chip. RA-324 prototype fix: no "Archived: "
      // prefix — just the bare value.
      expect(result).toContain(
        'data-testid="active-filter-label">Archived</span>'
      )
      expect(result).not.toContain('Archived: shown')
      // Its removal href drops includeArchived (keeping the page unfiltered).
      expect(result).toContain('data-testid="active-filter-remove"')
      // Backend still receives includeArchived=true (ra-224 param unchanged).
      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ includeArchived: true })
      )
    })

    test('Renders the Due on date from the Mongo $date shape', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue(
        emptyPage({
          items: [
            {
              id: 'cccccccc-1111-1111-1111-111111111111',
              typeId: 'unknown-type',
              stateId: 'assessment-in-progress',
              submittedAt: null,
              submittedBy: null,
              slaState: 'OnTrack',
              slaDueDate: { $date: '2026-02-10T00:00:00Z' },
              payload: {}
            }
          ],
          totalCount: 1
        })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).toContain('data-testid="due-on"')
      expect(result).toContain('10 February 2026')
    })

    test('Drops unknown material, status and sort values', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?material=unobtanium&status=ghost&sort=sideways'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({
          materials: [],
          stateIds: [],
          sort: null
        })
      )
    })
  })

  // ---------------------------------------------------------------- //
  // RA-299 — Application-type filter (AC01/15)                       //
  // ---------------------------------------------------------------- //
  describe('RA-299 application-type filter', () => {
    test('Renders a distinct "Application type" section alongside "Applicant type"', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).toContain('data-testid="filter-section-type"')
      expect(result).toContain('data-testid="filter-section-application-type"')
      expect(result).toContain(
        'data-testid="filter-section-application-type-toggle"'
      )
      expect(result).toContain('Applicant type')
      expect(result).toContain('Application type')
      // The four AC01/15 options.
      expect(result).toContain('Re-accreditation')
      expect(result).toContain('Accreditation')
      expect(result).toContain('Registration application')
      expect(result).toContain('Payment of annual registration fee')
      // Submitted via its own param, distinct from typeId.
      expect(result).toContain('name="applicationType"')
    })

    test('Only "Re-accreditation" maps to the real typeId; the others are zero-result stubs', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?applicationType=accreditation&applicationType=registration-application&applicationType=annual-fee-payment&filtersApplied=1'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({
          typeIds: [
            'accreditation',
            'registration-application',
            'annual-fee-payment'
          ]
        })
      )
    })

    test('An application-type chip removal drops only that value', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?applicationType=re-accreditation&applicationType=accreditation&filtersApplied=1'
      })

      expect(result).toContain(
        'data-testid="active-filter-label">Re-accreditation</span>'
      )
      expect(result).toContain(
        'data-testid="active-filter-label">Accreditation</span>'
      )
      expect(result).toContain(
        'href="/work-items?applicationType=accreditation&amp;filtersApplied=1"'
      )
      expect(result).toContain(
        'href="/work-items?applicationType=re-accreditation&amp;filtersApplied=1"'
      )
    })
  })

  // ---------------------------------------------------------------- //
  // RA-299 — Material: split "Glass" filter (AC05)                    //
  // ---------------------------------------------------------------- //
  describe('RA-299 material glass split', () => {
    test('Renders "Glass- remelt" and "Glass- other" instead of a single "Glass" option', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).toContain('Glass- remelt')
      expect(result).toContain('Glass- other')
      expect(result).not.toContain('value="glass"')
      expect(result).toContain('value="glass-remelt"')
      expect(result).toContain('value="glass-other"')
    })

    // RA-299 AC05 judgement call (see materials.js): the operator backend has
    // no remelt/other distinction in the data model, so BOTH new filter
    // values map to the single real 'glass' backend token — either checkbox
    // surfaces the same (current) Glass work items, rather than each
    // returning zero results.
    test('Both glass filter values forward the same real "glass" backend token', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?material=glass-remelt&filtersApplied=1'
      })
      expect(getWorkItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ materials: ['glass'] })
      )

      await server.inject({
        method: 'GET',
        url: '/work-items?material=glass-other&filtersApplied=1'
      })
      expect(getWorkItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ materials: ['glass'] })
      )
    })

    test('Selecting both glass options dedupes to a single backend token', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?material=glass-remelt&material=glass-other&filtersApplied=1'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ materials: ['glass'] })
      )
    })

    test('Each glass option renders its own distinct active-filter chip', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?material=glass-remelt&filtersApplied=1'
      })

      expect(result).toContain(
        'data-testid="active-filter-label">Glass- remelt</span>'
      )
    })
  })

  // ---------------------------------------------------------------- //
  // RA-299 — Default sort (AC06)                                      //
  // ---------------------------------------------------------------- //
  describe('RA-299 default sort', () => {
    test('Defaults to due-date sort on a bare landing (no query string)', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({ method: 'GET', url: '/work-items' })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'due-date' })
      )
    })

    test('The default sort does NOT render a "Sorted by" active-filter chip', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).not.toContain('Sorted by:')
    })

    test('An explicit form submission with no sort picked clears the default (no sort)', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?filtersApplied=1'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ sort: null })
      )
    })

    test('An explicit sort choice still renders its "Sorted by" chip', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?sort=organisation&filtersApplied=1'
      })

      expect(result).toContain('Sorted by: Organisation')
    })

    test('A defaulted sort is not carried into pagination hrefs as if explicit', async () => {
      clearWorkItemRegistry()
      getWorkItems.mockResolvedValue({
        ok: true,
        items: [
          {
            id: '55555555-5555-5555-5555-555555555555',
            typeId: 'unknown-type',
            stateId: 'submitted',
            submittedAt: '2026-04-27T10:00:00Z',
            submittedBy: null,
            payload: {}
          }
        ],
        totalCount: 45,
        page: 1,
        pageSize: 20
      })

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).not.toContain('sort=due-date')
    })
  })

  // ---------------------------------------------------------------- //
  // RA-299 — Default assignee = mine (AC08/09)                        //
  // ---------------------------------------------------------------- //
  describe('RA-299 default assignee', () => {
    test('Defaults to the signed-in user on a bare landing (no query string)', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({ method: 'GET', url: '/work-items' })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeId: 'test-standard-id',
          unassigned: false
        })
      )
    })

    test('The default "mine" assignee does NOT render a "Your applications" chip', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })

      expect(result).not.toContain('Your applications</span>')
    })

    test('An explicit form submission with no assignee ticked shows all (clears the default)', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?filtersApplied=1'
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: null, unassigned: false })
      )
    })

    test('An explicit "mine" selection still renders its chip', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items?assigneeMode=mine&filtersApplied=1'
      })

      expect(result).toContain(
        'data-testid="active-filter-label">Your applications</span>'
      )
    })
  })

  // ---------------------------------------------------------------- //
  // RA-299 — Session persistence within the current session (AC10/14) //
  // ---------------------------------------------------------------- //
  describe('RA-299 filter session persistence', () => {
    function sessionCookie(res) {
      return [].concat(res.headers['set-cookie'] ?? []).join('; ')
    }

    test('A bare landing after applying filters restores them from the session', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const applied = await server.inject({
        method: 'GET',
        url: '/work-items?material=plastic&filtersApplied=1'
      })
      const cookie = sessionCookie(applied)

      getWorkItems.mockClear()
      await server.inject({
        method: 'GET',
        url: '/work-items',
        headers: { cookie }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ materials: ['plastic'] })
      )
    })

    test('An explicit empty submission (filtersApplied=1, nothing ticked) is itself the restorable state, not the AC06/AC08 defaults', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      // First apply a real filter, then explicitly clear it (a real
      // "Clear all filters" / empty resubmission carries filtersApplied=1).
      const applied = await server.inject({
        method: 'GET',
        url: '/work-items?material=plastic&filtersApplied=1'
      })
      const firstCookie = sessionCookie(applied)

      const cleared = await server.inject({
        method: 'GET',
        url: '/work-items?filtersApplied=1',
        headers: { cookie: firstCookie }
      })
      // yar re-issues a cookie on every write, so the SECOND response's
      // cookie (not the first) is the one carrying the now-cleared session.
      const cookie = sessionCookie(cleared) || firstCookie

      getWorkItems.mockClear()
      // A later bare landing restores the explicitly-cleared state (no
      // materials, and no AC06/AC08 defaults reapplied) rather than reviving
      // the earlier 'plastic' filter or the hard defaults.
      await server.inject({
        method: 'GET',
        url: '/work-items',
        headers: { cookie }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({
          materials: [],
          sort: null,
          assigneeId: null,
          unassigned: false
        })
      )
    })

    test('An unrecognised query param does not overwrite the saved filters', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const applied = await server.inject({
        method: 'GET',
        url: '/work-items?material=plastic&filtersApplied=1'
      })
      const firstCookie = sessionCookie(applied)

      // A shared/bookmarked link carrying only an incidental tracking param is
      // not a filter submission — it must not be read as "user cleared
      // everything" and wipe the saved state.
      const incidental = await server.inject({
        method: 'GET',
        url: '/work-items?utm_source=email',
        headers: { cookie: firstCookie }
      })
      const cookie = sessionCookie(incidental) || firstCookie

      getWorkItems.mockClear()
      await server.inject({
        method: 'GET',
        url: '/work-items',
        headers: { cookie }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ materials: ['plastic'] })
      )
    })

    test('Clear all (?clear=1) drops the saved filters and lands on the AC06/AC08 defaults', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const applied = await server.inject({
        method: 'GET',
        url: '/work-items?material=plastic&filtersApplied=1'
      })
      const firstCookie = sessionCookie(applied)

      const cleared = await server.inject({
        method: 'GET',
        url: '/work-items?clear=1',
        headers: { cookie: firstCookie }
      })
      const cookie = sessionCookie(cleared) || firstCookie

      getWorkItems.mockClear()
      // The whole point of AC12: a bare landing after Clear all must NOT
      // resurrect 'plastic' from the session — it lands on the defaults.
      await server.inject({
        method: 'GET',
        url: '/work-items',
        headers: { cookie }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ materials: [], sort: 'due-date' })
      )
    })

    test("A brand-new session (no cookie) does not restore another session's filters", async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      await server.inject({
        method: 'GET',
        url: '/work-items?material=plastic&filtersApplied=1'
      })

      getWorkItems.mockClear()
      // No cookie forwarded — a genuinely separate session — falls back to
      // the AC06/AC08 hard defaults, not the previous session's 'plastic'.
      await server.inject({ method: 'GET', url: '/work-items' })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({
          materials: [],
          sort: 'due-date',
          assigneeId: 'test-standard-id'
        })
      )
    })

    test('A query string on the request itself always wins over any saved session filters', async () => {
      getWorkItems.mockResolvedValue(emptyPage())

      const applied = await server.inject({
        method: 'GET',
        url: '/work-items?material=plastic&filtersApplied=1'
      })
      const cookie = sessionCookie(applied)

      getWorkItems.mockClear()
      await server.inject({
        method: 'GET',
        url: '/work-items?material=steel&filtersApplied=1',
        headers: { cookie }
      })

      expect(getWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ materials: ['steel'] })
      )
    })
  })
})
