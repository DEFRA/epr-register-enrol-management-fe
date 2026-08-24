import { describe, expect, test } from 'vitest'

import { buildCaseHeader, buildCaseTabs, formatDueOn } from './case-header.js'

const EM_DASH = '—'

function metaValue(header, key) {
  return header.meta.find((entry) => entry.key === key)?.value
}

describe('#formatDueOn (RA-295 AC01)', () => {
  test('formats an ISO-8601 UTC instant as a GDS date in UK local time', () => {
    // June is BST (UTC+1), so 23:30Z is already the 27th locally — proving
    // the conversion happens rather than the UTC date being printed raw.
    expect(formatDueOn('2026-06-26T23:30:00Z')).toBe('27 June 2026')
  })

  test('unwraps the Mongo extended-JSON shape', () => {
    expect(formatDueOn({ $date: '2026-08-24T09:00:00Z' })).toBe(
      '24 August 2026'
    )
  })

  test('renders an em dash when no SLA clock has started (null)', () => {
    expect(formatDueOn(null)).toBe(EM_DASH)
    expect(formatDueOn(undefined)).toBe(EM_DASH)
  })

  test('renders an em dash rather than throwing on an unparseable value', () => {
    expect(formatDueOn('not-a-date')).toBe(EM_DASH)
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
      operatorOrganisationId: 'ORG-123-001',
      material: 'plastic',
      registrationNumber: 'EPR-100999'
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
    expect(header.organisationId).toBe('ORG-123-001')
    expect(metaValue(header, 'material')).toBe('Plastic')
    expect(metaValue(header, 'status')).toBe('Duly made')
    expect(metaValue(header, 'assigned-to')).toBe('Alice Example')
    expect(metaValue(header, 'due-on')).toBe('24 August 2026')
    expect(metaValue(header, 'registration-number')).toBe('EPR-100999')
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
  // read as a live deadline, so "Due on" degrades to the em dash — exactly as
  // it does for a work item whose clock never started.
  test('suppresses the Due on date for a Cancelled SLA (RA-359 part 2)', () => {
    const header = buildCaseHeader({
      workItem: { ...workItem, slaState: 'Cancelled' }
    })
    expect(metaValue(header, 'due-on')).toBe(EM_DASH)
  })

  test('keeps the Due on date for a running SLA (OnTrack) unchanged', () => {
    const header = buildCaseHeader({
      workItem: { ...workItem, slaState: 'OnTrack' }
    })
    expect(metaValue(header, 'due-on')).toBe('24 August 2026')
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
})

describe('#buildCaseTabs (RA-295, RA-434, RA-469)', () => {
  // RA-469 follow-up: the tab is currently hidden (HIDE_RECYCLING_OPERATIONS_TAB
  // in case-header.js) at product's request, pending a reword — these three
  // tabs are what actually renders today.
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
