import { CHECKBOX_FILTERS, resolveTypeFilter } from './list-filters.js'
import { ROLE_NATION_SCOTLAND } from '#/server/common/helpers/auth/auth-scopes.js'
import {
  checkboxFilterParamNames,
  checkboxFilterRequest,
  checkboxFilterSections,
  readCheckboxFilters
} from './checkbox-filters.js'

const NONE = {
  type: [],
  applicationType: [],
  inYearChange: [],
  orsManagement: [],
  status: [],
  nation: [],
  material: []
}

describe('#list-filters', () => {
  test('declares the checkbox filters in link and chip order, with their params', () => {
    expect(CHECKBOX_FILTERS.map((d) => d.key)).toEqual(Object.keys(NONE))
    expect(checkboxFilterParamNames(CHECKBOX_FILTERS)).toEqual([
      'typeId',
      'applicationType',
      'inYearChange',
      'orsManagement',
      'status',
      'nation',
      'material'
    ])
  })

  test('section ids and titles match the template data-testids', () => {
    const sections = checkboxFilterSections(CHECKBOX_FILTERS, NONE)
    expect(Object.values(sections).map(({ id, title }) => [id, title])).toEqual(
      [
        ['type', 'Applicant type'],
        ['application-type', 'Application type'],
        ['in-year-change', 'In-year change'],
        ['ors-management', 'ORS management'],
        ['status', 'Status'],
        ['nation', 'Nation'],
        ['material', 'Material']
      ]
    )
  })

  describe('backend request', () => {
    test('sends empty lists when nothing is ticked', () => {
      expect(checkboxFilterRequest(CHECKBOX_FILTERS, NONE)).toEqual({
        wasteProcessingTypes: [],
        stateIds: [],
        nations: [],
        materials: []
      })
    })

    test.each([
      [['exporter'], ['Exporter']],
      [['re-accreditation'], ['Reprocessor']],
      [['re-accreditation', 'exporter'], []]
    ])(
      'Applicant type %j narrows wasteProcessingTypes to %j',
      (type, expected) => {
        expect(
          checkboxFilterRequest(CHECKBOX_FILTERS, { ...NONE, type })
            .wasteProcessingTypes
        ).toEqual(expected)
      }
    )

    test('Status expands each group to its state ids, de-duplicated', () => {
      expect(
        checkboxFilterRequest(CHECKBOX_FILTERS, {
          ...NONE,
          status: ['updated', 'rejected']
        }).stateIds
      ).toEqual([
        'assessment-in-progress',
        'updated',
        'rejected',
        'rejected-pending-contact'
      ])
    })

    test('Material sends the backend tokens', () => {
      expect(
        checkboxFilterRequest(CHECKBOX_FILTERS, {
          ...NONE,
          material: ['glass-remelt', 'glass-other', 'wood']
        }).materials
      ).toEqual(['glass', 'wood'])
    })
  })

  describe('Nation default', () => {
    const scotlandUser = { roles: [ROLE_NATION_SCOTLAND] }

    test("a landing defaults to the user's only nation", () => {
      expect(
        readCheckboxFilters(
          CHECKBOX_FILTERS,
          {},
          { user: scotlandUser, filtersApplied: false }
        ).nation
      ).toEqual(['Scotland'])
    })

    test('a submitted form with no nation ticked has no default', () => {
      expect(
        readCheckboxFilters(
          CHECKBOX_FILTERS,
          {},
          { user: scotlandUser, filtersApplied: true }
        ).nation
      ).toEqual([])
    })

    test('a user with no single nation role has no default', () => {
      expect(
        readCheckboxFilters(
          CHECKBOX_FILTERS,
          {},
          { user: { roles: [] }, filtersApplied: false }
        ).nation
      ).toEqual([])
    })
  })

  describe('resolveTypeFilter', () => {
    test('sends Application type typeIds and categories as ticked', () => {
      expect(
        resolveTypeFilter({
          ...NONE,
          applicationType: ['re-accreditation', 'in-year-change']
        })
      ).toEqual({
        typeIds: ['re-accreditation'],
        categories: ['in-year-change']
      })
    })

    test('ignores the in-year sections when In-year change is not ticked', () => {
      expect(
        resolveTypeFilter({
          ...NONE,
          applicationType: ['accreditation'],
          inYearChange: ['tonnage']
        })
      ).toEqual({ typeIds: ['accreditation'], categories: [] })
    })

    test('ORS management narrows only the ORS option', () => {
      expect(
        resolveTypeFilter({
          ...NONE,
          applicationType: ['in-year-change'],
          orsManagement: ['updates']
        })
      ).toEqual({
        typeIds: ['upgrade-tonnage-band', 'update-overseas-site'],
        categories: []
      })
    })
  })
})
