import {
  appendCheckboxFilterParams,
  buildCheckboxOptions,
  checkboxFilterChips,
  checkboxFilterCounts,
  checkboxFilterParamNames,
  checkboxFilterRequest,
  checkboxFilterSections,
  isCheckboxFilterKey,
  readCheckboxFilters,
  uniqueStringList,
  withoutCheckboxValue
} from './checkbox-filters.js'

const COLOUR = {
  key: 'colour',
  title: 'Colour',
  options: [
    { value: 'red', text: 'Red' },
    { value: 'blue', text: 'Blue', chip: 'Blue colour' }
  ],
  toRequest: (values) => ({ colours: values.map((v) => v.toUpperCase()) })
}
const SHAPE = {
  key: 'shapeKind',
  param: 'shape',
  title: 'Shape kind',
  options: [
    { value: 'square', text: 'Square' },
    { value: 'circle', text: 'Circle' }
  ],
  normalise: (value) => value.toLowerCase(),
  defaultValues: ({ filtersApplied }) => (filtersApplied ? [] : ['circle'])
}
const DESCRIPTORS = [COLOUR, SHAPE]

describe('#checkbox-filters', () => {
  describe('buildCheckboxOptions', () => {
    test('ticks the selected options, in option order', () => {
      expect(buildCheckboxOptions(COLOUR.options, ['blue'])).toEqual([
        { value: 'red', text: 'Red', checked: false },
        { value: 'blue', text: 'Blue', checked: true }
      ])
    })

    test('ticks nothing for a null selection', () => {
      expect(
        buildCheckboxOptions(COLOUR.options, [null]).map((o) => o.checked)
      ).toEqual([false, false])
    })
  })

  describe('uniqueStringList', () => {
    test('trims, drops blanks and non-strings, and de-duplicates', () => {
      expect(uniqueStringList([' a ', 'a', '', 'b', 3, null])).toEqual([
        'a',
        'b'
      ])
    })

    test('accepts a single string or nothing', () => {
      expect(uniqueStringList('a')).toEqual(['a'])
      expect(uniqueStringList(undefined)).toEqual([])
    })
  })

  describe('readCheckboxFilters', () => {
    const context = { user: null, filtersApplied: true }

    test('reads each filter from its param, dropping unknown values', () => {
      expect(
        readCheckboxFilters(
          DESCRIPTORS,
          { colour: ['blue', 'green', 'red'], shape: 'square' },
          context
        )
      ).toEqual({ colour: ['blue', 'red'], shapeKind: ['square'] })
    })

    test('the param defaults to the key, so a key alone is not read', () => {
      expect(
        readCheckboxFilters(DESCRIPTORS, { shapeKind: 'square' }, context)
          .shapeKind
      ).toEqual([])
    })

    test('normalises before validating and de-duplicates afterwards', () => {
      expect(
        readCheckboxFilters(
          DESCRIPTORS,
          { shape: ['Square', 'square', 'CIRCLE'] },
          context
        ).shapeKind
      ).toEqual(['square', 'circle'])
    })

    test('uses defaultValues only when no valid value is submitted', () => {
      const landing = { user: null, filtersApplied: false }
      expect(
        readCheckboxFilters(DESCRIPTORS, { shape: 'hexagon' }, landing)
          .shapeKind
      ).toEqual(['circle'])
      expect(
        readCheckboxFilters(DESCRIPTORS, { shape: 'square' }, landing).shapeKind
      ).toEqual(['square'])
      expect(readCheckboxFilters(DESCRIPTORS, {}, context).shapeKind).toEqual(
        []
      )
    })
  })

  test('checkboxFilterRequest merges the toRequest params of each filter', () => {
    expect(
      checkboxFilterRequest(DESCRIPTORS, {
        colour: ['red'],
        shapeKind: ['square']
      })
    ).toEqual({ colours: ['RED'] })
  })

  test('appendCheckboxFilterParams appends values in descriptor order', () => {
    const params = new URLSearchParams()
    appendCheckboxFilterParams(params, DESCRIPTORS, {
      colour: ['blue', 'red'],
      shapeKind: ['circle']
    })
    expect(params.toString()).toBe('colour=blue&colour=red&shape=circle')
  })

  test('checkboxFilterParamNames lists each filter param', () => {
    expect(checkboxFilterParamNames(DESCRIPTORS)).toEqual(['colour', 'shape'])
  })

  test('checkboxFilterChips labels each value by its chip, else its text', () => {
    expect(
      checkboxFilterChips(DESCRIPTORS, {
        colour: ['red', 'blue'],
        shapeKind: ['circle']
      })
    ).toEqual([
      { key: 'colour', value: 'red', label: 'Red' },
      { key: 'colour', value: 'blue', label: 'Blue colour' },
      { key: 'shapeKind', value: 'circle', label: 'Circle' }
    ])
  })

  test('checkboxFilterCounts counts the selected values per filter', () => {
    expect(
      checkboxFilterCounts(DESCRIPTORS, { colour: ['red'], shapeKind: [] })
    ).toEqual({ colour: 1, shapeKind: 0 })
  })

  test('isCheckboxFilterKey recognises only descriptor keys', () => {
    expect(isCheckboxFilterKey(DESCRIPTORS, 'shapeKind')).toBe(true)
    expect(isCheckboxFilterKey(DESCRIPTORS, 'shape')).toBe(false)
  })

  test('withoutCheckboxValue removes one value without mutating', () => {
    const selected = { colour: ['red', 'blue'], shapeKind: ['circle'] }
    expect(withoutCheckboxValue(selected, 'colour', 'red')).toEqual({
      colour: ['blue'],
      shapeKind: ['circle']
    })
    expect(selected.colour).toEqual(['red', 'blue'])
  })

  test('checkboxFilterSections gives the template data keyed by filter', () => {
    expect(
      checkboxFilterSections(DESCRIPTORS, {
        colour: [],
        shapeKind: ['square']
      })
    ).toEqual({
      colour: {
        id: 'colour',
        name: 'colour',
        title: 'Colour',
        count: 0,
        items: [
          { value: 'red', text: 'Red', checked: false },
          { value: 'blue', text: 'Blue', checked: false }
        ]
      },
      shapeKind: {
        id: 'shape-kind',
        name: 'shape',
        title: 'Shape kind',
        count: 1,
        items: [
          { value: 'square', text: 'Square', checked: true },
          { value: 'circle', text: 'Circle', checked: false }
        ]
      }
    })
  })
})
