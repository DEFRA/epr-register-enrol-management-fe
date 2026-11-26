import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { addOverseasSiteType } from '#/server/work-items/add-overseas-site/module.js'

import {
  NOT_RECEIVED,
  buildCaseHeader,
  buildCaseTabs,
  caseHasTab,
  decorateForCaseHeader,
  formatHeaderDate,
  chargeEntry,
  formatPaymentDate,
  stateDisplayName
} from './case-header.js'

const EM_DASH = '—'

function metaValue(header, key) {
  return header.meta.find((entry) => entry.key === key)?.value
}

describe('#formatHeaderDate (RA-295 AC01)', () => {
  test('formats an ISO-8601 UTC instant as a GDS date in UK local time', () => {
    // June is BST (UTC+1), so 23:30Z is already the 27th locally — proving
    // the conversion happens rather than the UTC date being printed raw.
    expect(formatHeaderDate('2026-06-26T23:30:00Z')).toBe('27 Jun 2026')
  })

  test('unwraps the Mongo extended-JSON shape', () => {
    expect(formatHeaderDate({ $date: '2026-08-24T09:00:00Z' })).toBe(
      '24 Aug 2026'
    )
  })

  test('renders an em dash when no SLA clock has started (null)', () => {
    expect(formatHeaderDate(null)).toBe(EM_DASH)
    expect(formatHeaderDate(undefined)).toBe(EM_DASH)
  })

  test('renders an em dash rather than throwing on an unparseable value', () => {
    expect(formatHeaderDate('not-a-date')).toBe(EM_DASH)
  })
})

describe('#formatPaymentDate (RA-493)', () => {
  test('shows "Not received" before the item is duly made (AC04)', () => {
    expect(formatPaymentDate({ chargeAmountPence: 327600 })).toBe(NOT_RECEIVED)
    expect(formatPaymentDate({ paymentDate: null })).toBe(NOT_RECEIVED)
    expect(NOT_RECEIVED).toBe('Not received')
  })

  test('tolerates a missing payload', () => {
    expect(formatPaymentDate(undefined)).toBe(NOT_RECEIVED)
  })

  test('formats the recorded date once duly made (AC01, AC02)', () => {
    expect(formatPaymentDate({ paymentDate: '2026-11-01' })).toBe('01 Nov 2026')
  })

  test('shows "Not received" rather than throwing on an unparseable payment date', () => {
    expect(formatPaymentDate({ paymentDate: 'not-a-date' })).toBe(NOT_RECEIVED)
  })

  test('unwraps the Mongo extended-JSON date shape', () => {
    expect(
      formatPaymentDate({ paymentDate: { $date: '2026-11-01T00:00:00Z' } })
    ).toBe('01 Nov 2026')
  })
})

describe('#chargeEntry', () => {
  test('renders whole-pound charges with pence, matching the duly-making page (user decision 2026-11-18)', () => {
    expect(chargeEntry(327600)).toEqual({
      key: 'charge',
      label: 'Charge',
      value: '£3,276.00'
    })
    expect(chargeEntry(327650).value).toBe('£3,276.50')
  })

  test('treats a £0 charge as a real amount, not a missing one', () => {
    expect(chargeEntry(0).value).toBe('£0.00')
  })

  test('renders an em dash when no charge is recorded', () => {
    expect(chargeEntry(null).value).toBe(EM_DASH)
    expect(chargeEntry(undefined).value).toBe(EM_DASH)
  })
})

describe('#buildCaseHeader (RA-295 AC01)', () => {
  const workItem = {
    id: 'w-1',
    stateDisplayName: 'Duly made',
    stateTagClass: 'govuk-tag--blue',
    slaDueDate: '2026-08-24T09:00:00Z',
    payload: {
      applicationReference: 'RA-2026-00001',
      organisationName: 'GreenLoop Recovery',
      // RA-503: operatorOrganisationId is ReEx's internal ObjectId (deliberately ObjectId-shaped
      // here, not the 6-digit admin-created shape) — operatorOrgNumber is the value that must
      // actually be displayed. See the #resolveOrganisationId describe block below for the
      // fallback-shape coverage.
      operatorOrganisationId: '6a74a6a12b7c39b0cc15ca55',
      operatorOrgNumber: 500500,
      material: 'plastic',
      registrationNumber: 'EPR-100999',
      chargeAmountPence: 218400
    }
  }

  test('carries every field AC01 lists', () => {
    const header = buildCaseHeader({
      workItem,
      assignment: { assignedToName: 'Alice Example' }
    })

    expect(header.backHref).toBe('/work-items')
    expect(header.backText).toBe('Applications')
    expect(header.applicationRef).toBe('RA-2026-00001')
    expect(header.organisationName).toBe('GreenLoop Recovery')
    expect(header.organisationId).toBe(500500)
    expect(metaValue(header, 'material')).toBe('Plastic')
    expect(metaValue(header, 'status')).toBe('Duly made')
    expect(metaValue(header, 'assigned-to')).toBe('Alice Example')
    expect(metaValue(header, 'due-on')).toBe('24 Aug 2026')
    expect(metaValue(header, 'registration-number')).toBe('EPR-100999')
    expect(metaValue(header, 'payment-date')).toBe('Not received')
  })

  // Duly making records no amount paid, so the charge shows from submission
  // and the payment date alone says whether it has been paid.
  test('shows the charge before the item is paid', () => {
    expect(metaValue(buildCaseHeader({ workItem }), 'charge')).toBe('£2,184.00')
  })

  test('has the ten meta items in the order add-ORS shares', () => {
    const header = buildCaseHeader({
      workItem: {
        ...workItem,
        payload: { ...workItem.payload, paymentDate: '2026-11-01' }
      }
    })

    expect(header.meta.map((entry) => [entry.key, entry.label])).toEqual([
      ['request-type', 'Application type'],
      ['status', 'Status'],
      ['assigned-to', 'Assigned to'],
      ['due-on', 'Due date'],
      ['registration-number', 'Registration number'],
      ['material', 'Material'],
      ['charge', 'Charge'],
      ['payment-date', 'Payment date'],
      ['submitted-by', 'Submitted by'],
      ['date-added', 'Submitted on']
    ])
    expect(metaValue(header, 'charge')).toBe('£2,184.00')
    expect(metaValue(header, 'payment-date')).toBe('01 Nov 2026')
  })

  test('shows the type, submission date and submitter, falling back to the contact details', () => {
    const value = (header, key) =>
      header.meta.find((entry) => entry.key === key).value
    const item = {
      ...workItem,
      typeDisplayName: 'Re-accreditation',
      submittedAt: '2026-10-05T09:00:00Z',
      payload: {
        ...workItem.payload,
        submittedBy: { fullName: 'Sam Operator' }
      }
    }

    const header = buildCaseHeader({ workItem: item })
    expect(value(header, 'request-type')).toBe('Re-accreditation')
    expect(value(header, 'date-added')).toBe('05 Oct 2026')
    expect(value(header, 'submitted-by')).toBe('Sam Operator')

    const older = buildCaseHeader({
      workItem: {
        ...item,
        payload: {
          ...workItem.payload,
          submitterContactDetails: { fullName: 'Pat Contact' }
        }
      }
    })
    expect(value(older, 'submitted-by')).toBe('Pat Contact')
    expect(
      value(
        buildCaseHeader({ workItem: { ...item, payload: workItem.payload } }),
        'submitted-by'
      )
    ).toBe('—')
  })

  // The decision panel shows the accreditation start date once Granted, so
  // the header leaves it out.
  test('has no Valid from date, even once Granted', () => {
    const header = buildCaseHeader({
      workItem: {
        ...workItem,
        stateId: 'approved',
        payload: { ...workItem.payload, accreditationStartDate: '2027-01-01' }
      }
    })
    expect(header.meta.map((entry) => entry.key)).not.toContain(
      'effective-date'
    )
  })

  test('appends the glass recycling type suffix to the material meta entry', () => {
    const header = buildCaseHeader({
      workItem: {
        ...workItem,
        payload: {
          ...workItem.payload,
          material: 'glass',
          glassRecyclingProcess: 'glass_other'
        }
      }
    })
    expect(metaValue(header, 'material')).toBe('Glass - Other')
  })

  // RA-359 part 2. management-be keeps `slaDueDate` on a terminal/withdrawn
  // item but reports the new `slaState: 'Cancelled'`. A stopped clock must not
  // read as a live deadline, so "Due date" degrades to the em dash — exactly as
  // it does for a work item whose clock never started.
  test('suppresses the Due date for a Cancelled SLA (RA-359 part 2)', () => {
    const header = buildCaseHeader({
      workItem: { ...workItem, slaState: 'Cancelled' }
    })
    expect(metaValue(header, 'due-on')).toBe(EM_DASH)
  })

  test('keeps the Due date for a running SLA (OnTrack) unchanged', () => {
    const header = buildCaseHeader({
      workItem: { ...workItem, slaState: 'OnTrack' }
    })
    expect(metaValue(header, 'due-on')).toBe('24 Aug 2026')
  })

  test('keeps the shared state-badge colour on the status entry', () => {
    const header = buildCaseHeader({ workItem })
    const status = header.meta.find((entry) => entry.key === 'status')
    expect(status.tagClass).toBe('govuk-tag--blue')
  })

  test('renders the status as plain text when the work item was not decorated', () => {
    const header = buildCaseHeader({
      workItem: { id: 'w-1', stateId: 'submitted', payload: {} }
    })
    const status = header.meta.find((entry) => entry.key === 'status')
    expect(status.tagClass).toBeNull()
    // Falls back to the raw state id rather than rendering nothing.
    expect(status.value).toBe('submitted')
  })

  test('falls back to the work item id when there is no application reference', () => {
    const header = buildCaseHeader({ workItem: { id: 'w-1', payload: {} } })
    expect(header.applicationRef).toBe('w-1')
  })

  test('falls back to an em dash when there is neither reference nor id', () => {
    const header = buildCaseHeader({ workItem: { payload: {} } })
    expect(header.applicationRef).toBe(EM_DASH)
  })

  test('tolerates a work item with no payload at all', () => {
    const header = buildCaseHeader({ workItem: {} })
    expect(header.organisationName).toBe(EM_DASH)
    expect(header.organisationId).toBeNull()
    expect(metaValue(header, 'material')).toBe(EM_DASH)
    expect(metaValue(header, 'status')).toBe(EM_DASH)
    expect(metaValue(header, 'due-on')).toBe(EM_DASH)
    expect(metaValue(header, 'registration-number')).toBe(EM_DASH)
  })

  test('reads the assignee off the work item when no assignment model is given', () => {
    expect(
      metaValue(
        buildCaseHeader({
          workItem: { payload: {}, assignedToName: 'Bob Example' }
        }),
        'assigned-to'
      )
    ).toBe('Bob Example')

    expect(
      metaValue(
        buildCaseHeader({ workItem: { payload: {}, assignedToId: 'bob-1' } }),
        'assigned-to'
      )
    ).toBe('bob-1')
  })

  test('shows "Unassigned" when nobody holds the work item', () => {
    expect(
      metaValue(buildCaseHeader({ workItem: { payload: {} } }), 'assigned-to')
    ).toBe('Unassigned')
  })

  // RA-503: operatorOrganisationId means two different things depending on how the work item
  // was created — ReEx's internal ObjectId for a real operator submission (never safe to show),
  // or a genuine 6-digit organisation number for a case-management admin-created item (RA-448
  // validates this shape before submission, see re-accreditation/create/schema.js). Shape alone
  // tells the two apart: an ObjectId can never match ^\d{6}$.
  describe('organisation id resolution (RA-503)', () => {
    test('prefers operatorOrgNumber when present, even alongside an ObjectId-shaped operatorOrganisationId', () => {
      const header = buildCaseHeader({
        workItem: {
          payload: {
            operatorOrganisationId: '6a74a6a12b7c39b0cc15ca55',
            operatorOrgNumber: 500500
          }
        }
      })
      expect(header.organisationId).toBe(500500)
    })

    test('falls back to operatorOrganisationId when it is genuinely 6-digit numeric (admin-created work item)', () => {
      const header = buildCaseHeader({
        workItem: { payload: { operatorOrganisationId: '500001' } }
      })
      expect(header.organisationId).toBe('500001')
    })

    test('does not fall back to an ObjectId-shaped operatorOrganisationId', () => {
      const header = buildCaseHeader({
        workItem: {
          payload: { operatorOrganisationId: '6a74a6a12b7c39b0cc15ca55' }
        }
      })
      expect(header.organisationId).toBeNull()
    })

    test('does not fall back to a non-numeric operatorOrganisationId of any other shape', () => {
      const header = buildCaseHeader({
        workItem: { payload: { operatorOrganisationId: 'ORG-123-001' } }
      })
      expect(header.organisationId).toBeNull()
    })

    test('is null when neither field is present', () => {
      const header = buildCaseHeader({ workItem: { payload: {} } })
      expect(header.organisationId).toBeNull()
    })
  })
})

describe('#buildCaseTabs (RA-295, RA-434, RA-469)', () => {
  // RA-469 follow-up: the tab is currently hidden (its key is in
  // HIDDEN_TAB_KEYS in case-header.js) at product's request, pending a
  // reword — these three tabs are what actually renders today.
  test('marks the summary tab active and links the other two visible tabs to their pages', () => {
    const tabs = buildCaseTabs({ workItemId: 'w 1', active: 'summary' })

    expect(tabs).toEqual([
      {
        key: 'application-summary',
        text: 'Application summary',
        href: '/work-items/w%201',
        active: true
      },
      {
        key: 'application-history',
        text: 'Application history',
        href: '/work-items/w%201/audit-log',
        active: false
      },
      {
        key: 'additional-information',
        text: 'Additional information',
        href: '/work-items/w%201/additional-information',
        active: false
      }
    ])
  })

  // The route/page still exist (see the comment on HIDE_RECYCLING_OPERATIONS_TAB),
  // so a direct visit still calls buildCaseTabs with active: 'recycling-operations'
  // — it just never matches a tab, since that tab is filtered out. No tab is
  // marked active in that case, which is fine: there's nothing in the bar to
  // highlight for a hidden page.
  test('omits the recycling operations tab even when it is the active page (RA-469 follow-up)', () => {
    const tabs = buildCaseTabs({
      workItemId: 'w-1',
      active: 'recycling-operations'
    })
    expect(tabs.map((t) => t.key)).toEqual([
      'application-summary',
      'application-history',
      'additional-information'
    ])
    expect(tabs.every((t) => t.active === false)).toBe(true)
  })

  test('marks the history tab active on the audit log page', () => {
    const tabs = buildCaseTabs({ workItemId: 'w-1', active: 'history' })
    expect(tabs.map((t) => t.active)).toEqual([false, true, false])
  })

  test('marks the additional information tab active on its page (RA-434)', () => {
    const tabs = buildCaseTabs({
      workItemId: 'w-1',
      active: 'additional-information'
    })
    expect(tabs.map((t) => t.active)).toEqual([false, false, true])
  })
})

describe('#stateDisplayName', () => {
  test("reads the state's display name from the type", () => {
    expect(stateDisplayName(addOverseasSiteType, 'submitted')).toBe(
      'Not started'
    )
  })

  test('falls back to the raw state id when the type does not declare it', () => {
    expect(stateDisplayName(addOverseasSiteType, 'mystery')).toBe('mystery')
    expect(stateDisplayName(null, 'submitted')).toBe('submitted')
  })
})

describe("RA-739: a type's own header and tabs", () => {
  beforeAll(() => registerWorkItemType(addOverseasSiteType))
  afterAll(() => clearWorkItemRegistry())

  test("builds the header with the type's own buildCaseHeader, given the shared fields", () => {
    const header = buildCaseHeader({
      workItem: decorateForCaseHeader({
        id: 'w-1',
        typeId: 'add-overseas-site',
        stateId: 'submitted',
        payload: { site: { siteName: 'Denmark PR' } }
      })
    })
    expect(header).toMatchObject({
      backHref: '/work-items',
      backText: 'Applications',
      applicationRef: 'w-1',
      title: 'Denmark PR'
    })
  })

  test("a type's case has its own tabs, and a type without caseTabs has all four", () => {
    expect(caseHasTab(addOverseasSiteType, 'application-history')).toBe(true)
    expect(caseHasTab(addOverseasSiteType, 'additional-information')).toBe(
      false
    )
    expect(caseHasTab(addOverseasSiteType, 'recycling-operations')).toBe(false)
    expect(caseHasTab(null, 'recycling-operations')).toBe(true)
    expect(caseHasTab({ id: 'other' }, 'additional-information')).toBe(true)
    // RA-495. Only add-ORS has the Accreditation summary and Related
    // change requests tabs.
    expect(caseHasTab(addOverseasSiteType, 'accreditation-summary')).toBe(true)
    expect(caseHasTab(null, 'accreditation-summary')).toBe(false)
    expect(caseHasTab(null, 'related-requests')).toBe(false)
  })

  test('has the four RA-495 tabs for add-ORS, in Figma order', () => {
    const tabs = buildCaseTabs({
      workItemId: 'w-1',
      active: 'related-requests',
      typeId: 'add-overseas-site'
    })
    expect(tabs.map((tab) => [tab.key, tab.text, tab.active])).toEqual([
      ['application-summary', 'Application summary', false],
      ['accreditation-summary', 'Accreditation summary', false],
      ['related-requests', 'Related change requests (1)', true],
      ['application-history', 'Application history', false]
    ])
  })

  test.each([
    [3, 'Related change requests (3)'],
    [1, 'Related change requests (1)'],
    [null, 'Related change requests (1)'],
    [undefined, 'Related change requests (1)']
  ])(
    'RA-770: with %j requests in the submission, the tab reads %j',
    (relatedCount, text) => {
      const tabs = buildCaseTabs({
        workItemId: 'w-1',
        active: 'summary',
        typeId: 'add-overseas-site',
        relatedCount
      })
      expect(tabs.find((tab) => tab.key === 'related-requests').text).toBe(text)
    }
  )
})
