/**
 * RA-767 / RA-782. An ORS update (`update-overseas-site`) work item is an
 * in-year change: the Applications list renders it with the in-year change
 * card, and its detail page has the add-ORS header and tabs, an Application
 * summary comparing the ORS's current details with the requested ones, and
 * the Standard lifecycle with no payment date and no valid from date.
 *
 * Route-level: the real server and the real module declarations and
 * templates, only the backend API mocked.
 */
import { vi } from 'vitest'
import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

vi.mock(
  '#/server/common/helpers/backend-api/backend-api.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    getWorkItem: vi.fn(),
    getAccreditationSummary: vi.fn(),
    getWorkItems: vi.fn(),
    getRelatedWorkItems: vi.fn(),
    applyWorkItemAction: vi.fn(),
    addWorkItemNote: vi.fn(),
    dulyMakeWorkItem: vi.fn(),
    getDulyMakeDetails: vi.fn(),
    recordWorkItemDecision: vi.fn(),
    confirmWorkItemApplicantContact: vi.fn()
  })
)

const {
  getWorkItem,
  getWorkItems,
  applyWorkItemAction,
  dulyMakeWorkItem,
  getDulyMakeDetails,
  addWorkItemNote,
  recordWorkItemDecision,
  confirmWorkItemApplicantContact
} = await import('#/server/common/helpers/backend-api/backend-api.js')

const ID = '78200001-0000-4000-8000-000000000001'
const SIBLING_ID = '78200001-0000-4000-8000-000000000002'
const DETAIL_URL = `/work-items/${ID}`
const DULY_MAKE_URL = `/work-items/update-overseas-site/${ID}/duly-make`
const DECISION_URL = `/work-items/update-overseas-site/${ID}/decision`
const CONFIRM_URL = `/work-items/update-overseas-site/${ID}/confirm-contact`
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
const EM_DASH = '—'

const squash = (text) => text.replace(/\s+/g, ' ').trim()

const INTERIM_KEPT = {
  siteId: 101,
  siteNumber: 'SN-0101',
  siteName: 'Bharat Recycling',
  country: 'Denmark',
  addressLine1: 'Havnegade 1',
  townOrCity: 'Aarhus',
  contactName: 'Asha Patel',
  contactEmail: 'asha@bharat.example',
  contactPhone: '0123456789',
  operationCodes: ['R13']
}

const INTERIM_CHANGED = {
  ...INTERIM_KEPT,
  siteId: 102,
  siteNumber: 'SN-0102',
  siteName: 'Valencia yard',
  contactName: 'Old Contact'
}

const INTERIM_REMOVED = {
  ...INTERIM_KEPT,
  siteId: 103,
  siteNumber: 'SN-0103',
  siteName: 'Quay Street hub'
}

function details(interim) {
  const { siteId, siteNumber, ...rest } = interim
  return rest
}

/** The site as the operator backend sends an update (RA-682). */
function aSite() {
  return {
    siteId: 902501,
    orsId: '007',
    siteName: 'Denmark PR',
    addressLine1: 'Ejbyvvej 12',
    addressLine2: 'Industrial Park',
    townOrCity: 'Copenhagen',
    country: 'Denmark',
    coordinates: '55.6761, 12.5683',
    contactName: 'John Smith',
    contactEmail: 'john.smith@denmarkpr.com',
    contactPhone: '+23 2489 2862',
    operationCodes: ['R5'],
    code1: 'B1030',
    repatriatedLoads: 'Returned to the UK exporter.',
    conditionsOfExport: true,
    chargePence: 0,
    interimSites: [
      INTERIM_KEPT,
      INTERIM_CHANGED,
      INTERIM_REMOVED,
      {
        ...INTERIM_KEPT,
        siteId: 104,
        siteName: 'Withdrawn earlier',
        removedAt: '2027-01-05T10:00:00Z'
      }
    ],
    besEvidence: {
      files: [
        {
          fileId: 'bes-current',
          filename: 'current-bes.pdf',
          scanStatus: 'Clean',
          besEvidenceValidFromDate: '2026-01-01',
          besEvidenceExpiryDate: '2027-12-31'
        }
      ]
    },
    addedBesEvidence: {
      files: [
        {
          fileId: 'bes-added',
          filename: 'added-bes.pdf',
          scanStatus: 'Clean',
          besEvidenceValidFromDate: '2027-01-01',
          besEvidenceExpiryDate: '2028-12-31'
        }
      ]
    },
    previous: {
      siteName: 'Denmark PR',
      addressLine1: 'Ejbyvvej 12',
      addressLine2: 'Industrial Park',
      townOrCity: 'Copenhagen',
      contactName: 'John Smith',
      contactEmail: 'john.smith@denmarkpr.com',
      contactPhone: '+23 2489 2862',
      repatriatedLoads: 'Returned to the UK exporter.'
    },
    proposed: {
      siteName: 'Denmark PR',
      addressLine1: 'Ejbyvvej 12',
      addressLine2: 'Industrial Park',
      townOrCity: 'Copenhagen',
      contactName: 'Jane Doe',
      contactEmail: 'john.smith@denmarkpr.com',
      contactPhone: '+23 2489 2999',
      repatriatedLoads: 'Returned to the UK exporter.'
    },
    interimSiteChanges: [
      {
        changeId: 'c-1',
        action: 'change',
        interimSiteId: 102,
        previous: details(INTERIM_CHANGED),
        proposed: { ...details(INTERIM_CHANGED), contactName: 'New Contact' }
      },
      {
        changeId: 'c-2',
        action: 'remove',
        interimSiteId: 103,
        previous: details(INTERIM_REMOVED)
      },
      {
        changeId: 'c-3',
        action: 'add',
        proposed: {
          siteName: 'Sagunto transfer station',
          country: 'Spain',
          addressLine1: 'Polígono Ingruinsa',
          townOrCity: 'Sagunto',
          contactName: 'Pablo Gil',
          contactEmail: 'p.gil@example.com',
          contactPhone: '+34 962 690 100',
          operationCodes: ['R13']
        }
      }
    ]
  }
}

function anUpdateItem({ stateId = 'submitted', assignedToName = null } = {}) {
  return {
    id: ID,
    typeId: 'update-overseas-site',
    stateId,
    templateVersion: 'v1',
    submittedAt: '2027-02-11T10:00:00Z',
    lastModifiedAt: '2027-02-11T10:00:00Z',
    assignedToId: assignedToName ? 'test-standard-id' : null,
    assignedToName,
    payload: {
      operatorRequestId: 'request-1:update-overseas-site',
      changeType: 'update-overseas-site',
      organisationName: 'GreenLoop Recovery',
      operatorOrgNumber: 123001,
      material: 'Plastic',
      accreditationYear: 2026,
      applicationReference: 'IYC-ORS-2026-00004',
      submissionReference: 'SUB-2026-0002',
      submissionSize: 2,
      accreditationReference: 'ACC-REP-PL-0007',
      chargePence: 0,
      submittedBy: { fullName: 'Sam Operator' },
      site: aSite()
    },
    availableActions: []
  }
}

let server

describe('RA-767 / RA-782: ORS update applications', () => {
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

  async function detailPage(workItem = anUpdateItem()) {
    getWorkItem.mockResolvedValue({ ok: true, workItem })
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: DETAIL_URL
    })
    expect(statusCode).toBe(statusCodes.ok)
    return cheerio.load(result)
  }

  function postForm(url, payload) {
    return injectWithCrumb(server, {
      method: 'POST',
      url,
      payload,
      headers: FORM
    })
  }

  async function followRedirect(posted) {
    expect(posted.statusCode).toBe(statusCodes.redirect)
    expect(posted.headers.location).toBe(DETAIL_URL)
    const cookie = []
      .concat(posted.headers['set-cookie'] ?? [])
      .map((header) => header.split(';')[0])
      .join('; ')
    const followed = await server.inject({
      method: 'GET',
      url: DETAIL_URL,
      headers: { cookie }
    })
    return cheerio.load(followed.result)
  }

  // RA-767 AC4.
  describe('Applications list card', () => {
    test('shows the request type, the site name and ORS id, and the submission', async () => {
      getWorkItems.mockResolvedValue({
        ok: true,
        items: [anUpdateItem()],
        totalCount: 1,
        page: 1,
        pageSize: 20
      })

      const { result } = await server.inject({
        method: 'GET',
        url: '/work-items'
      })
      const $ = cheerio.load(result)
      const card = $(`[data-work-item-id="${ID}"]`)

      expect(squash(card.find('[data-testid="request-type"]').text())).toBe(
        'Request type: Update ORS Accreditation'
      )
      expect(squash(card.find('[data-testid="application-site"]').text())).toBe(
        'Denmark PR (007)'
      )
      expect(
        squash(card.find('[data-testid="submission-reference"]').text())
      ).toBe('SUB-2026-0002 (2 requests)')
      expect(card.find('[data-testid="registration-number"]')).toHaveLength(0)
      expect(
        squash(card.find(`[data-testid="work-item-state-tag-${ID}"]`).text())
      ).toBe('Not started')
      expect(card.text()).toContain('Submitted on:')
    })
  })

  describe('detail page', () => {
    test('has the add-ORS header with no payment date', async () => {
      const $ = await detailPage()

      expect($('[data-testid="update-overseas-site-detail"]')).toHaveLength(1)
      expect(squash($('[data-testid="case-header-title"]').text())).toBe(
        'Denmark PR (007)'
      )
      const meta = $(
        '[data-testid="case-header-meta"] .app-case-header__meta-item'
      )
        .map((_, el) => squash($(el).text()))
        .get()
      expect(meta).toEqual([
        'Application type: Update ORS Accreditation',
        'Status: Not started',
        'Assigned to: Unassigned',
        `Due date: ${EM_DASH}`,
        'Accreditation number: ACC-REP-PL-0007',
        'Material: Plastic',
        'Charge: £0.00',
        `Payment date: ${EM_DASH}`,
        'Submitted by: Sam Operator',
        'Submitted on: 11 Feb 2027'
      ])
    })

    test('has the four add-ORS tabs, with Application summary active', async () => {
      const $ = await detailPage()

      const tabs = $('[data-testid="case-tabs"] [data-testid^="tab-"]')
        .map((_, el) => ({
          key: $(el).attr('data-testid').replace(/^tab-/, ''),
          text: squash($(el).text()),
          href: $(el).attr('href') ?? null
        }))
        .get()
      expect(tabs).toEqual([
        {
          key: 'application-summary',
          text: 'Application summary',
          href: null
        },
        {
          key: 'accreditation-summary',
          text: 'Accreditation summary',
          href: `${DETAIL_URL}/accreditation-summary`
        },
        {
          key: 'related-requests',
          text: 'Related change requests (2)',
          href: `${DETAIL_URL}/related-requests`
        },
        {
          key: 'application-history',
          text: 'Application history',
          href: `${DETAIL_URL}/audit-log`
        }
      ])
      expect($('[data-testid="work-item-actions"]')).toHaveLength(0)
    })
  })

  // RA-782 AC2.
  describe('Application summary', () => {
    test('introduces the change', async () => {
      const $ = await detailPage()

      expect(squash($('[data-testid="update-ors-intro"]').text())).toBe(
        'The operator wants to change the details of ORS 007, which is on their 2026 accreditation. Each changed detail is marked.'
      )
    })

    test('compares each detail, current version against requested change, in accessible tables', async () => {
      const $ = await detailPage()

      const table = $(
        '[data-testid="update-ors-group-contact-details"] [data-testid="update-ors-table"]'
      )
      expect(squash(table.find('caption').text())).toBe('Contact details')
      expect(
        table
          .find('thead th')
          .map((_, el) => [[$(el).attr('scope'), squash($(el).text())]])
          .get()
      ).toEqual([
        ['col', 'Detail'],
        ['col', 'Current version'],
        ['col', 'Requested change']
      ])
      expect(table.find('tbody th[scope="row"]')).toHaveLength(3)

      const row = (key) => ({
        current: squash($(`[data-testid="update-ors-current-${key}"]`).text()),
        requested: squash(
          $(`[data-testid="update-ors-requested-${key}"]`).text()
        ),
        changed: $(`[data-testid="update-ors-row-${key}"]`).attr(
          'data-changed'
        ),
        tag: squash($(`[data-testid="update-ors-changed-${key}"]`).text())
      })
      expect(row('contact-name')).toEqual({
        current: 'John Smith',
        requested: 'Jane Doe',
        changed: 'true',
        tag: 'Changed'
      })
      expect(
        $('[data-testid="update-ors-changed-contact-name"]').hasClass(
          'govuk-tag--blue'
        )
      ).toBe(true)
      expect(row('contact-phone')).toMatchObject({
        current: '+23 2489 2862',
        requested: '+23 2489 2999',
        changed: 'true'
      })
      expect(row('site-name')).toEqual({
        current: 'Denmark PR',
        requested: 'Denmark PR',
        changed: 'false',
        tag: ''
      })
      // Locked details show unchanged from the site.
      expect(row('coordinates')).toMatchObject({
        current: '55.6761, 12.5683',
        requested: '55.6761, 12.5683',
        changed: 'false'
      })
      expect(row('conditions-of-export')).toMatchObject({
        current: 'Yes',
        requested: 'Yes'
      })
    })

    test("lists the ORS's BES files and the new ones, each downloadable", async () => {
      const $ = await detailPage()

      const files = $('[data-testid="update-ors-bes-evidence"] li')
        .map((_, el) => ({
          name: squash(
            $(el).find('[data-testid="app-detail-document"]').text()
          ),
          href: $(el).find('a').attr('href'),
          isNew:
            $(el).find('[data-testid="app-detail-document-new"]').length === 1
        }))
        .get()
      expect(files).toEqual([
        {
          name: 'current-bes.pdf',
          href: `/work-items/${ID}/files/bes-current/download`,
          isNew: false
        },
        {
          name: 'added-bes.pdf',
          href: `/work-items/${ID}/files/bes-added/download`,
          isNew: true
        }
      ])
    })

    test('says so when the ORS has no BES evidence', async () => {
      const item = anUpdateItem()
      delete item.payload.site.besEvidence
      delete item.payload.site.addedBesEvidence
      const $ = await detailPage(item)

      expect(
        squash(
          $(
            '[data-testid="update-ors-bes-evidence"] [data-testid="app-detail-documents-none"]'
          ).text()
        )
      ).toBe('No documents uploaded.')
    })

    test('shows each interim site with what the update does to it', async () => {
      const $ = await detailPage()

      const sections = $('[data-testid="update-ors-interim-site"]')
        .map((_, el) => ({
          title: squash(
            $(el).find('[data-testid="update-ors-interim-site-title"]').text()
          ),
          tag: squash(
            $(el).find('[data-testid="update-ors-interim-site-tag"]').text()
          ),
          tagClass: $(el)
            .find('[data-testid="update-ors-interim-site-tag"]')
            .attr('class'),
          open: $(el).attr('open') !== undefined
        }))
        .get()
      expect(sections).toEqual([
        {
          title: 'Interim site 1: Bharat Recycling',
          tag: 'No changes',
          tagClass: 'govuk-tag govuk-tag--grey',
          open: false
        },
        {
          title: 'Interim site 2: Valencia yard',
          tag: 'Changed',
          tagClass: 'govuk-tag govuk-tag--blue',
          open: true
        },
        {
          title: 'Interim site 3: Quay Street hub',
          tag: 'Removed',
          tagClass: 'govuk-tag govuk-tag--red',
          open: true
        },
        {
          title: 'Interim site 4: Sagunto transfer station',
          tag: 'New interim site',
          tagClass: 'govuk-tag govuk-tag--purple',
          open: true
        }
      ])
    })

    test('compares a changed interim site and lists a new one', async () => {
      const $ = await detailPage()
      const [, changed, removed, added] = $(
        '[data-testid="update-ors-interim-site"]'
      ).toArray()

      expect(
        squash(
          $(changed)
            .find('[data-testid="update-ors-interim-requested-contact-name"]')
            .text()
        )
      ).toBe('New Contact')
      expect(
        squash(
          $(changed)
            .find('[data-testid="update-ors-interim-changed-contact-name"]')
            .text()
        )
      ).toBe('Changed')
      expect(
        squash(
          $(removed).find('[data-testid="update-ors-interim-site-note"]').text()
        )
      ).toBe('The operator wants to remove this interim site.')
      expect(
        squash($(added).find('[data-testid="interim-site-location"]').text())
      ).toBe('Polígono Ingruinsa, Sagunto, Spain')
    })
  })

  // RA-782 AC4.
  describe('duly making', () => {
    test('shows the charge and payment reference as "-" and asks for no payment date', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anUpdateItem() })
      getDulyMakeDetails.mockResolvedValue({
        ok: true,
        details: {
          workItemId: ID,
          chargePence: 0,
          takesPaymentDate: false,
          relatedWorkItems: [
            {
              id: ID,
              typeId: 'update-overseas-site',
              stateId: 'submitted',
              applicationReference: 'IYC-ORS-2026-00004',
              siteName: 'Denmark PR',
              orsId: '007',
              chargePence: 0
            },
            {
              id: SIBLING_ID,
              typeId: 'update-overseas-site',
              stateId: 'submitted',
              applicationReference: 'IYC-ORS-2026-00005',
              siteName: 'Belgium PR',
              orsId: '010',
              chargePence: 0
            }
          ]
        }
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: DULY_MAKE_URL
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect(
        squash($('[data-testid="duly-making-charge-amount"]').text())
      ).toBe('-')
      expect(
        squash($('[data-testid="duly-making-payment-reference"]').text())
      ).toBe('-')
      expect($('[data-testid="duly-making-payment-date"]')).toHaveLength(0)
      expect(squash($('[data-testid="duly-making-lead"]').text())).toBe(
        'There is no charge for this application, so there is no payment date to add.'
      )
      expect($('[data-testid="duly-making-submit"]')).toHaveLength(1)
      // RA-767: related rows name the type by its label.
      expect(
        $('[data-testid="duly-making-related-type"]')
          .map((_, el) => squash($(el).text()))
          .get()
      ).toEqual(['Update ORS Accreditation', 'Update ORS Accreditation'])
    })

    test('duly makes without a payment date', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anUpdateItem() })
      dulyMakeWorkItem.mockResolvedValue({
        ok: true,
        workItem: anUpdateItem({ stateId: 'duly-made' })
      })

      const posted = await postForm(DULY_MAKE_URL, '')

      expect(dulyMakeWorkItem).toHaveBeenCalledTimes(1)
      const [args] = dulyMakeWorkItem.mock.calls[0]
      expect(args.workItemId).toBe(ID)
      expect(args.paymentDate).toBeNull()
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anUpdateItem({ stateId: 'duly-made' })
      })
      const $ = await followRedirect(posted)
      expect(
        squash($('[data-testid="work-item-flash-banner"]').text())
      ).toContain('The application is now duly made.')
    })

    test('ignores any payment date posted anyway', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anUpdateItem() })
      dulyMakeWorkItem.mockResolvedValue({
        ok: true,
        workItem: anUpdateItem({ stateId: 'duly-made' })
      })

      await postForm(
        DULY_MAKE_URL,
        'payment-date-day=99&payment-date-month=&payment-date-year='
      )

      expect(dulyMakeWorkItem.mock.calls[0][0].paymentDate).toBeNull()
    })

    test('a failure re-reads nothing and redirects with a banner', async () => {
      getWorkItem.mockResolvedValue({ ok: true, workItem: anUpdateItem() })
      dulyMakeWorkItem.mockResolvedValue({
        ok: false,
        reason: 'invalid',
        status: 400,
        errorCode: 'payment-date-not-taken',
        message: 'This work item type takes no payment date.'
      })

      const posted = await postForm(DULY_MAKE_URL, '')

      const $ = await followRedirect(posted)
      expect(
        squash($('[data-testid="work-item-flash-banner"]').text())
      ).toContain('There was a problem completing duly making. Try again.')
    })
  })

  describe('determination and applicant contact', () => {
    function anItemIn(stateId) {
      return anUpdateItem({ stateId, assignedToName: 'Test Standard User' })
    }

    test('the Make determination page asks for no valid from date', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('duly-made')
      })

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: DECISION_URL
      })

      expect(statusCode).toBe(statusCodes.ok)
      const $ = cheerio.load(result)
      expect($('[data-testid="log-decision-form"]').attr('action')).toBe(
        DECISION_URL
      )
      expect(
        $('[data-testid="log-decision-effective-date-group"]')
      ).toHaveLength(0)
    })

    test('approving records the decision with no valid from date', async () => {
      getWorkItem.mockResolvedValue({
        ok: true,
        workItem: anItemIn('assessment-started')
      })
      addWorkItemNote.mockResolvedValue({ ok: true })
      recordWorkItemDecision.mockResolvedValue({
        ok: true,
        workItem: anItemIn('approved-pending-contact')
      })

      const { statusCode } = await postForm(
        DECISION_URL,
        'decision=approved&decisionNote=Fine'
      )

      expect(statusCode).toBe(statusCodes.redirect)
      const [args] = recordWorkItemDecision.mock.calls[0]
      expect(args).toMatchObject({ workItemId: ID, outcome: 'approved' })
      expect(args.effectiveDate ?? null).toBeNull()
      expect(applyWorkItemAction).not.toHaveBeenCalled()
    })

    test('an approval awaiting contact offers no Change valid from date link', async () => {
      const item = anItemIn('approved-pending-contact')
      item.payload.effectiveDate = '2027-03-01'
      const $ = await detailPage(item)

      expect(
        $('[data-testid="confirm-applicant-contact-cta"]').attr('href')
      ).toBe(CONFIRM_URL)
      expect($('[data-testid="change-valid-from-link"]')).toHaveLength(0)
    })

    test.each([
      [
        'approved-pending-contact',
        'approved',
        "The applicant has been contacted and the overseas reprocessing site's details have been updated on their accreditation."
      ],
      [
        'rejected-pending-contact',
        'rejected',
        "The applicant has been contacted and the overseas reprocessing site's details stay as they were."
      ]
    ])(
      'confirming contact on a %s update says what happened to the ORS',
      async (stateId, closedStateId, text) => {
        getWorkItem.mockResolvedValue({ ok: true, workItem: anItemIn(stateId) })
        confirmWorkItemApplicantContact.mockResolvedValue({
          ok: true,
          workItem: anItemIn(closedStateId)
        })

        const posted = await postForm(CONFIRM_URL, 'applicantContacted=yes')

        getWorkItem.mockResolvedValue({
          ok: true,
          workItem: anItemIn(closedStateId)
        })
        const $ = await followRedirect(posted)
        expect(
          squash($('[data-testid="work-item-flash-banner"]').text())
        ).toContain(text)
      }
    )
  })
})
