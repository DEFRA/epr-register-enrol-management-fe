/**
 * RA-770. The Related change requests tab of an In-Year Change case: the
 * accreditation the request is for, then the requests submitted with this
 * one, read through management-be a page at a time.
 *
 * Route-level: the real server and the real templates, only the backend API
 * mocked.
 */
import { vi } from 'vitest'
import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

vi.mock(
  '#/server/common/helpers/backend-api/backend-api.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    getWorkItem: vi.fn(),
    getRelatedWorkItems: vi.fn(),
    getAccreditationSummary: vi.fn()
  })
)

const { getWorkItem, getRelatedWorkItems, getAccreditationSummary } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '77000001-0000-4000-8000-000000000001'
const RE_ACCREDITATION_ID = '77000001-0000-4000-8000-000000000099'
const URL = `/work-items/${ID}/related-requests`

const squash = (text) => text.replace(/\s+/g, ' ').trim()

function anAddOrsItem({ submissionSize = 3 } = {}) {
  return {
    id: ID,
    typeId: 'add-overseas-site',
    stateId: 'submitted',
    templateVersion: 'v2',
    submittedAt: '2027-02-11T10:00:00Z',
    payload: {
      applicationReference: 'IYC-2026-00001',
      submissionReference: 'SUB-2026-0001',
      submissionSize,
      accreditationReference: 'ACC-REP-PL-0007',
      site: { orsId: '007', siteName: 'Denmark PR' }
    },
    availableActions: []
  }
}

function anAccreditationRead() {
  return {
    ok: true,
    accreditation: {
      accreditationNumber: 'ER992415095748M',
      accreditationYear: 2027,
      wasteProcessingType: 'reprocessor',
      material: 'plastic'
    },
    accreditationStartDate: '2027-01-01'
  }
}

function anItem(n, overrides = {}) {
  return {
    id:
      n === 1
        ? ID
        : `77000001-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    typeId: 'add-overseas-site',
    stateId: 'submitted',
    applicationReference: `IYC-2026-${String(n).padStart(5, '0')}`,
    siteName: `Site ${n}`,
    orsId: String(n).padStart(3, '0'),
    chargePence: 32800,
    ...overrides
  }
}

function aPage({ count, page = 1, items }) {
  return {
    ok: true,
    related: { totalCount: count, page, pageSize: 10, items }
  }
}

function rows($) {
  const text = (row, key) =>
    squash($(row).find(`[data-testid="related-requests-${key}"]`).text())
  return $('[data-testid="related-requests-row"]')
    .map((_, row) => ({
      reference: text(row, 'reference'),
      link:
        $(row)
          .find('[data-testid="related-requests-reference"]')
          .attr('href') ?? null,
      site: text(row, 'site'),
      type: text(row, 'type'),
      charge: text(row, 'charge'),
      status: text(row, 'status')
    }))
    .get()
}

function accreditationRows($) {
  return $('[data-testid="related-accreditation"] .govuk-summary-list__row')
    .map((_, row) => [
      [
        squash($(row).find('.govuk-summary-list__key').text()),
        squash($(row).find('.govuk-summary-list__value').text())
      ]
    ])
    .get()
}

describe('RA-770: the Related change requests tab', () => {
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
    getRelatedWorkItems.mockReset()
    getAccreditationSummary.mockReset()
    getWorkItem.mockResolvedValue({ ok: true, workItem: anAddOrsItem() })
    getAccreditationSummary.mockResolvedValue(anAccreditationRead())
  })

  async function get(url = URL) {
    const response = await server.inject({ method: 'GET', url })
    return { ...response, $: cheerio.load(response.result) }
  }

  test('AC1: shows the accreditation, then the submission with this request first, every request linked', async () => {
    getRelatedWorkItems.mockResolvedValue(
      aPage({
        count: 3,
        items: [
          anItem(1),
          anItem(2, { chargePence: null, siteName: 'Belgium PR' }),
          anItem(3, { stateId: 'duly-made', chargePence: 0 })
        ]
      })
    )

    const { statusCode, $ } = await get()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('title').text()).toContain(
      'Related change requests — IYC-2026-00001'
    )
    const activeTab = $('[data-testid="tab-related-requests"]')
    expect(squash(activeTab.text())).toBe('Related change requests (3)')
    expect(activeTab.attr('href')).toBeUndefined()

    expect(
      squash($('[data-testid="related-accreditation-heading"]').text())
    ).toBe('Accreditation')
    expect(accreditationRows($)).toEqual([
      ['Accreditation number', 'ER992415095748M'],
      ['Status', 'Granted'],
      ['Accreditation start date', '1 January 2027'],
      ['Accreditation year', '2027']
    ])

    expect(squash($('[data-testid="related-requests-heading"]').text())).toBe(
      'Related requests (3)'
    )
    expect(
      $('[data-testid="related-requests-table"] th')
        .map((_, th) => squash($(th).text()))
        .get()
    ).toEqual(['Site name', 'Type', 'Charge', 'Status'])
    expect(rows($)).toEqual([
      {
        reference: 'IYC-2026-00001',
        link: `/work-items/${ID}`,
        site: 'Site 1 (001)',
        type: 'New ORS accreditation',
        charge: '£328.00',
        status: 'Not started'
      },
      {
        reference: 'IYC-2026-00002',
        link: '/work-items/77000001-0000-4000-8000-000000000002',
        site: 'Belgium PR (002)',
        type: 'New ORS accreditation',
        charge: '—',
        status: 'Not started'
      },
      {
        reference: 'IYC-2026-00003',
        link: '/work-items/77000001-0000-4000-8000-000000000003',
        site: 'Site 3 (003)',
        type: 'New ORS accreditation',
        charge: '£0.00',
        status: 'Duly made'
      }
    ])
    expect($('[data-testid="case-assignment-panel"]')).toHaveLength(0)
    expect($('.govuk-pagination')).toHaveLength(0)
    expect(getRelatedWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID, page: 1 })
    )
    expect(getAccreditationSummary).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID })
    )
  })

  test("the tab label's count is the work item's submission size, the heading's is the related read's", async () => {
    // Different numbers, so each can only have come from its own source.
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: anAddOrsItem({ submissionSize: 12 })
    })
    getRelatedWorkItems.mockResolvedValue(
      aPage({ count: 11, items: [anItem(1)] })
    )

    const { $ } = await get()

    expect(squash($('[data-testid="tab-related-requests"]').text())).toBe(
      'Related change requests (12)'
    )
    expect(squash($('[data-testid="related-requests-heading"]').text())).toBe(
      'Related requests (11)'
    )
  })

  test('the tab label has no count for a work item with no submission size', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: anAddOrsItem({ submissionSize: null })
    })
    getRelatedWorkItems.mockResolvedValue(
      aPage({ count: 1, items: [anItem(1)] })
    )

    const { $ } = await get()

    expect(squash($('[data-testid="tab-related-requests"]').text())).toBe(
      'Related change requests'
    )
  })

  test('AC2: a submission of more than 10 is paged, with links that keep the tab', async () => {
    getRelatedWorkItems.mockResolvedValue(
      aPage({ count: 12, page: 2, items: [anItem(11), anItem(12)] })
    )

    const { $ } = await get(`${URL}?page=2`)

    expect(getRelatedWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: ID, page: 2 })
    )
    expect(squash($('[data-testid="related-requests-heading"]').text())).toBe(
      'Related requests (12)'
    )
    expect(rows($).map(({ reference }) => reference)).toEqual([
      'IYC-2026-00011',
      'IYC-2026-00012'
    ])
    const pagination = $('.govuk-pagination')
    expect(pagination).toHaveLength(1)
    expect(
      pagination
        .find('.govuk-pagination__item a')
        .map((_, a) => $(a).attr('href'))
        .get()
    ).toEqual([URL, `${URL}?page=2`])
    expect(
      pagination.find('.govuk-pagination__item--current').text().trim()
    ).toBe('2')
    expect(pagination.find('.govuk-pagination__prev a').attr('href')).toBe(URL)
    expect(pagination.find('.govuk-pagination__next')).toHaveLength(0)
  })

  test('AC2: ten requests or fewer show on one page with no pagination', async () => {
    getRelatedWorkItems.mockResolvedValue(
      aPage({
        count: 10,
        items: Array.from({ length: 10 }, (_, i) => anItem(i + 1))
      })
    )

    const { $ } = await get()

    expect(rows($)).toHaveLength(10)
    expect($('.govuk-pagination')).toHaveLength(0)
  })

  test.each([['0'], ['-1'], ['abc'], ['']])(
    'asks management-be for page 1 when the page is %j',
    async (raw) => {
      getRelatedWorkItems.mockResolvedValue(
        aPage({ count: 1, items: [anItem(1)] })
      )

      await get(`${URL}?page=${raw}`)

      expect(getRelatedWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 })
      )
    }
  )

  test('AC4: a request submitted on its own lists only itself', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: anAddOrsItem({ submissionSize: 1 })
    })
    getRelatedWorkItems.mockResolvedValue(
      aPage({ count: 1, items: [anItem(1)] })
    )

    const { $ } = await get()

    expect(squash($('[data-testid="tab-related-requests"]').text())).toBe(
      'Related change requests (1)'
    )
    expect(squash($('[data-testid="related-requests-heading"]').text())).toBe(
      'Related requests (1)'
    )
    expect(rows($).map(({ link }) => link)).toEqual([`/work-items/${ID}`])
    expect($('.govuk-pagination')).toHaveLength(0)
  })

  test.each([
    [{ ok: false, status: 500, error: 'Backend returned 500' }],
    [{ ok: false, unusable: true, error: 'unusable' }],
    [{ ok: false, error: 'ECONNREFUSED' }]
  ])(
    'keeps the header, tabs and accreditation, and says the requests are not available, when the read gives %j',
    async (read) => {
      const warn = vi.spyOn(createLogger(), 'warn')
      getRelatedWorkItems.mockResolvedValue(read)

      const { statusCode, $ } = await get()

      expect(statusCode).toBe(statusCodes.ok)
      expect(squash($('[data-testid="case-header-title"]').text())).toBe(
        'Denmark PR (007)'
      )
      expect(accreditationRows($)).toHaveLength(4)
      expect(
        squash($('[data-testid="related-requests-unavailable"]').text())
      ).toBe('Related requests are not available at the moment.')
      expect($('[data-testid="related-requests-row"]')).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ workItemId: ID }),
        'Related requests not available'
      )
      warn.mockRestore()
    }
  )

  test('says the accreditation is not available, and still lists the requests, when that read fails', async () => {
    getAccreditationSummary.mockResolvedValue({ ok: false, status: 404 })
    getRelatedWorkItems.mockResolvedValue(
      aPage({ count: 1, items: [anItem(1)] })
    )

    const { statusCode, $ } = await get()

    expect(statusCode).toBe(statusCodes.ok)
    expect(
      squash($('[data-testid="related-accreditation-unavailable"]').text())
    ).toBe('Accreditation summary is not available at the moment.')
    expect(rows($)).toHaveLength(1)
  })

  test('says a registration-only request has no accreditation, without asking for it', async () => {
    const item = anAddOrsItem()
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        ...item,
        payload: {
          ...item.payload,
          accreditationReference: undefined,
          registrationReference: 'R26EX0500190001PL'
        }
      }
    })
    getRelatedWorkItems.mockResolvedValue(
      aPage({ count: 1, items: [anItem(1)] })
    )

    const { $ } = await get()

    expect(
      squash($('[data-testid="related-accreditation-unavailable"]').text())
    ).toBe(
      'This request is for a registration, which has no accreditation, so there is no accreditation summary to show.'
    )
    expect(getAccreditationSummary).not.toHaveBeenCalled()
  })

  test('is not found for a re-accreditation item, without asking for related requests', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: {
        id: RE_ACCREDITATION_ID,
        typeId: 're-accreditation',
        stateId: 'submitted',
        templateVersion: 'v1',
        payload: { applicationReference: 'RA-000000001' },
        availableActions: []
      }
    })

    const { statusCode } = await get(
      `/work-items/${RE_ACCREDITATION_ID}/related-requests`
    )

    expect(statusCode).toBe(statusCodes.notFound)
    expect(getRelatedWorkItems).not.toHaveBeenCalled()
  })

  test('is not found for an unknown work item', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    const { statusCode } = await get()

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('shows the work item unavailable page when the work item read fails', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 500, error: 'boom' })

    const { statusCode, result } = await get()

    expect(statusCode).toBe(502)
    expect(result).toContain('Work item unavailable')
  })
})
