/**
 * RA-770. The row and page helpers behind the Related change requests tab
 * (and the Duly make page's related list). The tab itself is covered in
 * `related-requests.route.test.js`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { addOverseasSiteType } from '#/server/work-items/add-overseas-site/module.js'
import { updateOverseasSiteType } from '#/server/work-items/update-overseas-site/module.js'

import {
  buildRelatedRequests,
  relatedWorkItemRow,
  requestedPage
} from './related-requests.js'

const EM_DASH = '—'

describe('RA-770: relatedWorkItemRow', () => {
  beforeAll(() => {
    registerWorkItemType(addOverseasSiteType)
    registerWorkItemType(updateOverseasSiteType)
  })
  afterAll(() => clearWorkItemRegistry())

  test('describes an add-ORS request by reference, site, type, charge and status', () => {
    expect(
      relatedWorkItemRow({
        id: 'wi-1',
        typeId: 'add-overseas-site',
        stateId: 'submitted',
        applicationReference: 'IYC-2026-00001',
        siteName: 'Denmark PR',
        orsId: '007',
        chargePence: 32800
      })
    ).toEqual({
      id: 'wi-1',
      reference: 'IYC-2026-00001',
      site: 'Denmark PR (007)',
      type: 'Accreditation: add registered ORS',
      charge: '£328.00',
      status: 'Not started',
      statusTagClass: expect.any(String)
    })
  })

  test('falls back to dashes and the type id when the request lacks them', () => {
    const row = relatedWorkItemRow({
      id: 'wi-2',
      typeId: 'not-a-registered-type',
      stateId: 'submitted',
      applicationReference: null,
      siteName: null,
      orsId: null,
      chargePence: null
    })
    expect(row).toMatchObject({
      reference: EM_DASH,
      site: EM_DASH,
      type: 'not-a-registered-type',
      charge: EM_DASH
    })
  })

  test('shows the site name alone without an ORS id, and the dash with no type at all', () => {
    const row = relatedWorkItemRow({
      id: 'wi-3',
      stateId: 'submitted',
      siteName: 'Belgium PR'
    })
    expect(row).toMatchObject({ site: 'Belgium PR', type: EM_DASH })
  })

  // RA-681. management-be's related item carries its site's `selected` flag,
  // so an ORS update row is labelled per item, as its card and case header are.
  test.each([
    [true, 'Accreditation: ORS update'],
    [false, 'Registration: ORS update'],
    [null, 'ORS update'],
    [undefined, 'ORS update']
  ])(
    "labels an ORS update with site selected %s as '%s'",
    (selected, expected) => {
      expect(
        relatedWorkItemRow({
          id: 'wi-5',
          typeId: 'update-overseas-site',
          stateId: 'submitted',
          selected
        }).type
      ).toBe(expected)
    }
  )

  test('keeps the add-ORS label whatever its site selected flag', () => {
    expect(
      relatedWorkItemRow({
        id: 'wi-6',
        typeId: 'add-overseas-site',
        stateId: 'submitted',
        selected: false
      }).type
    ).toBe('Accreditation: add registered ORS')
  })

  test('shows a £0 charge as £0.00, as the case header does, not as no charge', () => {
    expect(
      relatedWorkItemRow({ id: 'wi-4', stateId: 'submitted', chargePence: 0 })
        .charge
    ).toBe('£0.00')
  })
})

describe('RA-770: buildRelatedRequests', () => {
  const basePath = '/work-items/wi-1/related-requests'
  const page = (n, totalCount) => ({
    totalCount,
    page: n,
    pageSize: 10,
    items: []
  })

  test('has no pagination for one page', () => {
    expect(
      buildRelatedRequests({ related: page(1, 10), basePath }).pagination
    ).toBeNull()
  })

  test('links every page, the first without page=, and next from page 1', () => {
    expect(
      buildRelatedRequests({ related: page(1, 21), basePath }).pagination
    ).toEqual({
      previous: null,
      next: { href: `${basePath}?page=2` },
      items: [
        { number: 1, href: basePath, current: true },
        { number: 2, href: `${basePath}?page=2`, current: false },
        { number: 3, href: `${basePath}?page=3`, current: false }
      ]
    })
  })

  test('has previous and next from a middle page', () => {
    const { pagination } = buildRelatedRequests({
      related: page(2, 21),
      basePath
    })
    expect(pagination.previous).toEqual({ href: basePath })
    expect(pagination.next).toEqual({ href: `${basePath}?page=3` })
  })
})

describe('RA-770: requestedPage', () => {
  test.each([
    ['2', '2'],
    ['1', '1'],
    ['0', '0'],
    ['99999999999999999999', '99999999999999999999'],
    ['-4', '1'],
    ['+2', '1'],
    ['2abc', '1'],
    ['abc', '1'],
    ['', '1'],
    [['2', '3'], '1'],
    [undefined, '1']
  ])('reads %j as page %j', (raw, expected) => {
    expect(requestedPage(raw)).toBe(expected)
  })
})
