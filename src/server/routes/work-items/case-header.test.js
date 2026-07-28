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

describe('#buildCaseTabs (RA-295)', () => {
  test('marks the summary tab active and links the history tab to the audit log', () => {
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
      }
    ])
  })

  test('marks the history tab active on the audit log page', () => {
    const tabs = buildCaseTabs({ workItemId: 'w-1', active: 'history' })
    expect(tabs.map((t) => t.active)).toEqual([false, true])
  })
})
