import { describe, expect, test } from 'vitest'

import {
  buildOperatorResponse,
  findOperatorResponse,
  isOperatorResponseEntry,
  operatorResponseBesFiles
} from './operator-response.js'

const RESPONSE = {
  action: 'query-response-received',
  createdAt: '2027-03-02T10:30:00Z',
  createdByName: 'Operator Olly',
  details: {
    changes: {
      siteName: { from: 'Old Name', to: 'New Name' },
      contactEmail: 'new@example.com',
      rejectedLoadsArrangements: { old: 'A', new: 'B' }
    },
    interimSites: [
      {
        siteId: 'i-1',
        siteNumber: 2,
        changes: { postcode: { from: 'AA1', to: 'BB2' } }
      },
      { siteId: 'i-2', siteNumber: 3, changes: {} }
    ],
    besEvidenceFiles: [
      { fileId: 'f-1', filename: 'bes.pdf', scanStatus: 'Clean' },
      { fileId: 'f-2', filename: 'pending.pdf' }
    ],
    submittedBy: 'Olly Operator, Director',
    submittedAt: '2027-03-02T10:29:00Z'
  }
}

const workItem = (auditLog) => ({
  id: 'wi-1',
  payload: {
    site: { interimSites: [{ siteId: 'i-1', siteName: 'Interim One' }] }
  },
  auditLog
})

describe('isOperatorResponseEntry', () => {
  test('recognises a resume entry carrying response data', () => {
    expect(isOperatorResponseEntry(RESPONSE)).toBe(true)
    expect(
      isOperatorResponseEntry({
        action: 'resumed-from-query',
        details: { changes: {} }
      })
    ).toBe(true)
  })

  test.each([
    [undefined],
    [{ action: 'application-queried', details: { reason: 'x' } }],
    [{ action: 'query-response-received', details: {} }],
    [{ action: 'query-response-received' }]
  ])('rejects %j', (entry) => {
    expect(isOperatorResponseEntry(entry)).toBe(false)
  })
})

describe('findOperatorResponse', () => {
  test('returns the newest (first) response entry', () => {
    const newer = { ...RESPONSE, createdAt: 'newer' }
    expect(findOperatorResponse([newer, RESPONSE])).toBe(newer)
  })

  test('returns null with no response or no audit log', () => {
    expect(findOperatorResponse([{ action: 'assigned' }])).toBeNull()
    expect(findOperatorResponse(undefined)).toBeNull()
  })
})

describe('buildOperatorResponse', () => {
  test('is null when the operator has not responded', () => {
    expect(buildOperatorResponse({ workItem: workItem([]) })).toBeNull()
  })

  test('shows old -> new for ORS and interim-site changes', () => {
    const response = buildOperatorResponse({ workItem: workItem([RESPONSE]) })

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
        oldValue: null,
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
        siteNumber: 2,
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

  test('links a clean BES file for download from the work item', () => {
    const response = buildOperatorResponse({ workItem: workItem([RESPONSE]) })

    expect(response.besFiles[0]).toMatchObject({
      filename: 'bes.pdf',
      href: '/work-items/wi-1/files/f-1/download'
    })
    // A file that is not known clean is listed without a link.
    expect(response.besFiles[1]).toMatchObject({
      filename: 'pending.pdf',
      href: null
    })
  })

  test('falls back to the entry author when the details name no submitter', () => {
    const entry = { ...RESPONSE, details: { changes: { siteName: 'X' } } }
    expect(
      buildOperatorResponse({ workItem: workItem([entry]) }).submittedBy
    ).toBe('Operator Olly')
  })
})

describe('operatorResponseBesFiles', () => {
  test('returns the raw files of the latest response', () => {
    expect(
      operatorResponseBesFiles(workItem([RESPONSE])).map((f) => f.fileId)
    ).toEqual(['f-1', 'f-2'])
    expect(operatorResponseBesFiles(workItem([]))).toEqual([])
    expect(operatorResponseBesFiles(undefined)).toEqual([])
  })
})
