import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { realOperatorSubmissionPayload } from '#/test-helpers/real-operator-submission-payload.js'
import { buildAdditionalInformationRows } from './additional-information.controller.js'

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

const { getWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '44444444-4444-4444-4444-444444444444'
const HREF = `/work-items/${ID}/additional-information`

function aWorkItem(overrides = {}) {
  return {
    id: ID,
    typeId: 're-accreditation',
    stateId: 'submitted',
    submittedAt: '2026-04-27T10:00:00Z',
    lastModifiedAt: '2026-04-27T10:05:00Z',
    submittedBy: 'frontend',
    templateVersion: 'v1',
    payload: realOperatorSubmissionPayload(),
    availableActions: [],
    auditLog: [],
    ...overrides
  }
}

function registerReaccreditation() {
  registerWorkItemType({
    id: 're-accreditation',
    displayName: 'Re-accreditation',
    initialState: { id: 'submitted', displayName: 'Submitted' },
    states: [{ id: 'submitted', displayName: 'Submitted' }],
    getTasksForState: () => []
  })
}

function row(rows, key) {
  return rows.find((r) => r.key === key)
}

describe('#buildAdditionalInformationRows (RA-434)', () => {
  test('resolves every row from a real adapter payload, in the fixed order', () => {
    const rows = buildAdditionalInformationRows({
      workItem: { payload: realOperatorSubmissionPayload() }
    })

    expect(rows.map((r) => r.key)).toEqual([
      'organisation-name',
      'companies-house-number',
      'company-registered-address',
      // 'site-name' omitted — no producer field for it today.
      'site-address',
      'permit-numbers'
    ])
    expect(row(rows, 'organisation-name').value).toBe('Acme Recycling Ltd')
    expect(row(rows, 'companies-house-number').value).toBe('01234567')
    expect(row(rows, 'company-registered-address').value).toBe(
      '1 Example Street, London, EC1A 1BB'
    )
    expect(row(rows, 'permit-numbers').value).toBe('WML123456, PPC456789')
  })

  test('omits the Site name row entirely — there is no producer field for it', () => {
    const rows = buildAdditionalInformationRows({
      workItem: { payload: realOperatorSubmissionPayload() }
    })
    expect(row(rows, 'site-name')).toBeUndefined()
  })

  test("uses the reprocessor Site address for the fixture's default wasteProcessingType", () => {
    const rows = buildAdditionalInformationRows({
      workItem: { payload: realOperatorSubmissionPayload() }
    })
    // The fixture's flat siteAddress string already includes the postcode.
    expect(row(rows, 'site-address').value).toBe(
      '123 High Street, London, SW1A 1AA'
    )
  })

  test('falls back to the reprocessor branch when wasteProcessingType is absent entirely', () => {
    const payload = realOperatorSubmissionPayload()
    delete payload.wasteProcessingType
    const rows = buildAdditionalInformationRows({ workItem: { payload } })
    expect(row(rows, 'site-address').value).toBe(
      '123 High Street, London, SW1A 1AA'
    )
  })

  test('also falls back to the reprocessor branch for an unrecognised wasteProcessingType value', () => {
    const rows = buildAdditionalInformationRows({
      workItem: {
        payload: {
          ...realOperatorSubmissionPayload(),
          wasteProcessingType: 'unknown'
        }
      }
    })
    expect(row(rows, 'site-address').value).toBe(
      '123 High Street, London, SW1A 1AA'
    )
  })

  test('uses the registered address as the Site address for an exporter', () => {
    const rows = buildAdditionalInformationRows({
      workItem: {
        payload: {
          ...realOperatorSubmissionPayload(),
          wasteProcessingType: 'exporter'
        }
      }
    })
    // Intentional per RA-434: for an exporter, Site address == Registered
    // address, matching OJ's own header.
    expect(row(rows, 'site-address').value).toBe(
      '1 Example Street, London, EC1A 1BB'
    )
    expect(row(rows, 'site-address').value).toBe(
      row(rows, 'company-registered-address').value
    )
  })

  test('drops permit numbers that are blank or not strings, and omits the row entirely when none remain', () => {
    const rows = buildAdditionalInformationRows({
      workItem: {
        payload: {
          ...realOperatorSubmissionPayload(),
          permitNumbers: ['  ', null, 42, '']
        }
      }
    })
    expect(row(rows, 'permit-numbers')).toBeUndefined()
  })

  test('trims surrounding whitespace on a kept permit number rather than joining it in', () => {
    const rows = buildAdditionalInformationRows({
      workItem: {
        payload: {
          ...realOperatorSubmissionPayload(),
          permitNumbers: ['  WML123456  ', 'PPC456789']
        }
      }
    })
    expect(row(rows, 'permit-numbers').value).toBe('WML123456, PPC456789')
  })

  test('omits every row for a work item with no payload at all', () => {
    const rows = buildAdditionalInformationRows({ workItem: {} })
    expect(rows).toEqual([])
  })
})

describe('GET /work-items/{id}/additional-information (RA-434)', () => {
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
    clearWorkItemRegistry()
  })

  test('renders the tab with the case header, the active tab and the resolved rows', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: HREF
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkItem).toHaveBeenCalledWith({
      workItemId: ID,
      user: expect.objectContaining({ id: expect.any(String) })
    })
    expect(result).toEqual(
      expect.stringContaining('data-testid="tab-additional-information"')
    )
    expect(result).toEqual(
      expect.stringContaining(
        'data-testid="additional-information-row-organisation-name"'
      )
    )
    expect(result).toEqual(expect.stringContaining('Acme Recycling Ltd'))
    expect(result).toEqual(expect.stringContaining('01234567'))
    expect(result).toEqual(expect.stringContaining('WML123456, PPC456789'))
    // Provides a way back to the detail page.
    expect(result).toEqual(expect.stringContaining(`/work-items/${ID}`))
  })

  test('omits the Site name row from the rendered page', async () => {
    registerReaccreditation()
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { result } = await server.inject({ method: 'GET', url: HREF })

    expect(result).not.toEqual(
      expect.stringContaining(
        'data-testid="additional-information-row-site-name"'
      )
    )
  })

  test('renders 404 when the work item does not exist', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: HREF
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Application not found'))
  })

  test('renders 502 when the backend is unavailable', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 503, error: 'boom' })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: HREF
    })

    expect(statusCode).toBe(statusCodes.badGateway)
    expect(result).toEqual(expect.stringContaining('Work item unavailable'))
  })
})
