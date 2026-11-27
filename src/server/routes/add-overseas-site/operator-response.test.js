import { describe, expect, test } from 'vitest'

import {
  buildOperatorResponse,
  findOperatorResponse,
  operatorResponseBesFiles
} from './operator-response.js'

const LATEST = {
  respondedAt: '2027-03-02T10:30:00Z',
  submittedAt: '2027-03-02T10:29:00Z',
  responderContactDetails: {
    fullName: 'Olly Operator',
    email: 'olly@example.com',
    role: 'Director'
  },
  siteChanges: {
    siteName: { from: 'Old Name', to: 'New Name' },
    contactEmail: { from: null, to: 'new@example.com' },
    rejectedLoadsArrangements: { from: 'A', to: 'B' }
  },
  interimSiteChanges: [
    {
      siteId: 1,
      siteNumber: '002',
      changes: { postcode: { from: 'AA1', to: 'BB2' } }
    },
    { siteId: 2, siteNumber: '003', changes: {} }
  ],
  besEvidenceFiles: [{ fileId: 'f-1', filename: 'bes.pdf', s3Key: 'k' }]
}

const workItem = (latestQueryResponse) => ({
  id: 'wi-1',
  payload: {
    site: {
      interimSites: [{ siteId: 1, siteNumber: '002', siteName: 'Interim One' }]
    },
    ...(latestQueryResponse ? { latestQueryResponse } : {})
  }
})

describe('findOperatorResponse', () => {
  test('reads the latest response from the payload', () => {
    expect(findOperatorResponse(workItem(LATEST))).toBe(LATEST)
  })

  test('is null when there is none', () => {
    expect(findOperatorResponse(workItem())).toBeNull()
    expect(findOperatorResponse(undefined)).toBeNull()
  })
})

describe('buildOperatorResponse', () => {
  test('is null when the operator has not responded', () => {
    expect(buildOperatorResponse({ workItem: workItem() })).toBeNull()
  })

  test('shows old -> new for ORS and interim-site changes, and who responded', () => {
    const response = buildOperatorResponse({ workItem: workItem(LATEST) })

    expect(response.submittedBy).toBe('Olly Operator, Director')
    expect(response.changes).toEqual([
      {
        key: 'siteName',
        label: 'ORS name',
        oldValue: 'Old Name',
        newValue: 'New Name'
      },
      {
        key: 'contactEmail',
        label: 'Contact email',
        oldValue: expect.any(String),
        newValue: 'new@example.com'
      },
      {
        key: 'rejectedLoadsArrangements',
        label: 'Arrangements for rejected or returned loads',
        oldValue: 'A',
        newValue: 'B'
      }
    ])
    // An interim site with no changes is left out; one with changes is named.
    expect(response.interimSites).toEqual([
      {
        siteNumber: '002',
        siteName: 'Interim One',
        changes: [
          {
            key: 'postcode',
            label: 'Postcode',
            oldValue: 'AA1',
            newValue: 'BB2'
          }
        ]
      }
    ])
  })

  test('links the new BES files for download from the work item', () => {
    const response = buildOperatorResponse({ workItem: workItem(LATEST) })

    expect(response.besFiles[0]).toMatchObject({
      filename: 'bes.pdf',
      href: '/work-items/wi-1/files/f-1/download'
    })
  })

  test('falls back to the recorded time when no submitter or time is named', () => {
    const response = buildOperatorResponse({
      workItem: workItem({ siteChanges: { siteName: { from: 'A', to: 'B' } } })
    })

    expect(response.submittedBy).toBe('—')
  })
})

describe('buildOperatorResponse change shapes', () => {
  test('reads { from, to } pairs and bare values', () => {
    const view = buildOperatorResponse({
      workItem: workItem({
        siteChanges: {
          postcode: { from: 'A', to: 'B' },
          contactName: 'Plain'
        }
      })
    })
    expect(view.changes).toEqual([
      expect.objectContaining({
        key: 'postcode',
        oldValue: 'A',
        newValue: 'B'
      }),
      expect.objectContaining({
        key: 'contactName',
        oldValue: null,
        newValue: 'Plain'
      })
    ])
  })
})

describe('operatorResponseBesFiles', () => {
  test('lists the new files, treated as scanned clean', () => {
    const files = operatorResponseBesFiles(workItem(LATEST))

    expect(files.map((f) => f.fileId)).toEqual(['f-1'])
    expect(files[0].scanStatus).toBe('Clean')
    expect(operatorResponseBesFiles(workItem())).toEqual([])
    expect(operatorResponseBesFiles(undefined)).toEqual([])
  })
})
