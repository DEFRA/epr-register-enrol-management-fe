import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { addOverseasSiteType } from '#/server/work-items/add-overseas-site/module.js'
import {
  NOT_RECEIVED,
  decorateForCaseHeader
} from '#/server/routes/work-items/case-header.js'

import { buildAddOverseasSiteHeader } from './case-header.js'

const EM_DASH = '—'

const SHARED_HEADER = {
  backHref: '/work-items',
  backText: 'Applications',
  applicationRef: 'IYC-ORS-2026-00001'
}

function metaValue(header, key) {
  return header.meta.find((entry) => entry.key === key)?.value
}

function headerFor(workItem, assignment = null) {
  return buildAddOverseasSiteHeader({
    header: SHARED_HEADER,
    workItem,
    assignment
  })
}

describe('RA-739: add-ORS case header', () => {
  beforeAll(() => registerWorkItemType(addOverseasSiteType))
  afterAll(() => clearWorkItemRegistry())

  const addOrs = (overrides = {}) =>
    decorateForCaseHeader({
      id: 'w-1',
      typeId: 'add-overseas-site',
      stateId: 'submitted',
      payload: {
        applicationReference: 'IYC-ORS-2026-00001',
        organisationName: 'GreenLoop Recovery',
        operatorOrgNumber: 123001,
        material: 'Plastic',
        accreditationReference: 'ACC-1',
        site: { orsId: '007', siteName: 'Denmark PR', chargePence: 32800 }
      },
      ...overrides
    })

  test('decorates the work item with its type and state', () => {
    const item = addOrs()
    expect(item.typeDisplayName).toBe('New ORS accreditation')
    expect(item.stateDisplayName).toBe('Not started')
    expect(item.stateTagClass).toEqual(expect.any(String))
  })

  test('captions with the reference and titles with the site, without the organisation', () => {
    const header = headerFor(addOrs())
    expect(header).toMatchObject(SHARED_HEADER)
    expect(header.caption).toBe('IYC-ORS-2026-00001')
    expect(header.title).toBe('Denmark PR (007)')
    expect(header.metaLayout).toBe('in-year-change')
    expect(header.organisationName).toBeUndefined()
    expect(header.organisationId).toBeUndefined()
  })

  test('titles with the site name alone when there is no ORS id', () => {
    const item = addOrs()
    item.payload.site = { siteName: 'Denmark PR' }
    expect(headerFor(item).title).toBe('Denmark PR')
  })

  test('titles with the dash when there is no site', () => {
    const item = addOrs()
    delete item.payload.site
    expect(headerFor(item).title).toBe(EM_DASH)
  })

  test('has the eight meta items in Figma order', () => {
    const header = headerFor(addOrs())
    expect(header.meta.map((entry) => [entry.label, entry.value])).toEqual([
      ['Request type', 'New ORS accreditation'],
      ['Status', 'Not started'],
      ['Assigned to', 'Unassigned'],
      ['Due date', EM_DASH],
      ['Material', 'Plastic'],
      ['Accreditation number', 'ACC-1'],
      ['Charge', '£328'],
      ['Payment date', NOT_RECEIVED]
    ])
  })

  test('shows the dash for a missing accreditation number and charge', () => {
    const item = addOrs()
    item.payload.accreditationReference = undefined
    item.payload.site = { siteName: 'Denmark PR' }
    const header = headerFor(item)
    expect(metaValue(header, 'accreditation-number')).toBe(EM_DASH)
    expect(metaValue(header, 'charge')).toBe(EM_DASH)
  })

  test('shows the assignment panel name in Assigned to when there is one', () => {
    const header = headerFor(addOrs({ assignedToName: 'Old Name' }), {
      assignedToName: 'Stub Caseworker One'
    })
    expect(metaValue(header, 'assigned-to')).toBe('Stub Caseworker One')
  })

  test('suppresses the due date for a cancelled SLA, as on re-accreditation', () => {
    const due = { slaDueDate: '2027-03-11T10:00:00Z' }
    expect(
      metaValue(headerFor(addOrs({ ...due, slaState: 'OnTrack' })), 'due-on')
    ).toBe('11 Mar 2027')
    expect(
      metaValue(headerFor(addOrs({ ...due, slaState: 'Cancelled' })), 'due-on')
    ).toBe(EM_DASH)
  })
})
