import { describe, expect, test } from 'vitest'

import {
  ENTER_REASON_MESSAGE,
  QUERY_REASON_MAX_WORDS,
  QUERY_SECTION_OPTIONS,
  QUERY_SECTION_VALUES,
  REASON_TOO_LONG_MESSAGE,
  SELECT_SECTIONS_MESSAGE,
  buildErrorSummary,
  joiDetailsToFieldErrors,
  normaliseSections,
  validateQueryForm
} from './query.schema.js'

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

describe('QUERY_SECTION_OPTIONS', () => {
  test('are exactly the six agreed areas, in order', () => {
    expect(QUERY_SECTION_OPTIONS).toEqual([
      { value: 'authority-to-issue', text: 'Authority to issue' },
      { value: 'business-plan', text: 'Business plan' },
      { value: 'prn-tonnage', text: 'PRN tonnage' },
      {
        value: 'sampling-and-inspection-plan',
        text: 'Sampling and inspection plan'
      },
      {
        value: 'broadly-equivalent-standards',
        text: 'Broadly equivalent standards (BES)'
      },
      {
        value: 'overseas-reprocessing-sites',
        text: 'Overseas reprocessing sites (ORS)'
      }
    ])
    expect(QUERY_SECTION_VALUES).toHaveLength(6)
  })
})

describe('normaliseSections', () => {
  test('wraps a single string selection into an array', () => {
    expect(normaliseSections('business-plan')).toEqual(['business-plan'])
  })

  test('treats an empty string as no selection', () => {
    expect(normaliseSections('')).toEqual([])
  })

  test('passes arrays through, dropping empty and non-string entries', () => {
    expect(normaliseSections(['a', '', 'b', 5, null, undefined])).toEqual([
      'a',
      'b'
    ])
  })

  test('returns an empty array for missing or unexpected input', () => {
    expect(normaliseSections(undefined)).toEqual([])
    expect(normaliseSections(null)).toEqual([])
    expect(normaliseSections({ a: 1 })).toEqual([])
    expect(normaliseSections(7)).toEqual([])
  })
})

describe('joiDetailsToFieldErrors', () => {
  test('returns an empty object for missing details', () => {
    expect(joiDetailsToFieldErrors(undefined)).toEqual({})
    expect(joiDetailsToFieldErrors([])).toEqual({})
  })

  test('keeps the first message per top-level field', () => {
    const out = joiDetailsToFieldErrors([
      { path: ['sections', 0], message: 'first' },
      { path: ['sections'], message: 'second' },
      { path: ['reason'], message: 'reason msg' }
    ])
    expect(out).toEqual({ sections: 'first', reason: 'reason msg' })
  })

  test('ignores details with no path', () => {
    expect(joiDetailsToFieldErrors([{ message: 'orphan' }])).toEqual({})
    expect(joiDetailsToFieldErrors([{ path: [], message: 'orphan' }])).toEqual(
      {}
    )
  })
})

describe('buildErrorSummary', () => {
  test('returns null when there are no errors', () => {
    expect(buildErrorSummary({})).toBeNull()
  })

  test('anchors each item at #field-<name> in field order', () => {
    expect(buildErrorSummary({ reason: 'r msg', sections: 's msg' })).toEqual({
      titleText: 'There is a problem',
      items: [
        { text: 's msg', href: '#field-sections' },
        { text: 'r msg', href: '#field-reason' }
      ]
    })
  })
})

describe('validateQueryForm', () => {
  test('accepts a single section posted as a bare string', () => {
    const result = validateQueryForm({
      sections: 'prn-tonnage',
      reason: 'Please clarify'
    })
    expect(result).toEqual({
      ok: true,
      value: { sections: ['prn-tonnage'], reason: 'Please clarify' }
    })
  })

  test('accepts multiple sections and trims the reason', () => {
    const result = validateQueryForm({
      sections: ['business-plan', 'prn-tonnage'],
      reason: '  Needs work  '
    })
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({
      sections: ['business-plan', 'prn-tonnage'],
      reason: 'Needs work'
    })
  })

  test('rejects when no section is selected', () => {
    const result = validateQueryForm({ reason: 'A reason' })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.sections).toBe(SELECT_SECTIONS_MESSAGE)
    expect(result.fieldErrors.reason).toBeUndefined()
  })

  test('rejects an unknown section value', () => {
    const result = validateQueryForm({
      sections: ['not-a-section'],
      reason: 'A reason'
    })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.sections).toBe(SELECT_SECTIONS_MESSAGE)
  })

  test('rejects a missing reason', () => {
    const result = validateQueryForm({ sections: ['business-plan'] })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.reason).toBe(ENTER_REASON_MESSAGE)
  })

  test('rejects a whitespace-only reason', () => {
    const result = validateQueryForm({
      sections: ['business-plan'],
      reason: '   \n\t '
    })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.reason).toBe(ENTER_REASON_MESSAGE)
  })

  test('rejects a non-string reason', () => {
    const result = validateQueryForm({ sections: ['business-plan'], reason: 5 })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.reason).toBe(ENTER_REASON_MESSAGE)
  })

  test(`accepts exactly ${QUERY_REASON_MAX_WORDS} words`, () => {
    const result = validateQueryForm({
      sections: ['business-plan'],
      reason: words(QUERY_REASON_MAX_WORDS)
    })
    expect(result.ok).toBe(true)
  })

  test(`rejects ${QUERY_REASON_MAX_WORDS + 1} words`, () => {
    const result = validateQueryForm({
      sections: ['business-plan'],
      reason: words(QUERY_REASON_MAX_WORDS + 1)
    })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.reason).toBe(REASON_TOO_LONG_MESSAGE)
  })

  test('reports both field errors at once and echoes values back', () => {
    const result = validateQueryForm({})
    expect(result.ok).toBe(false)
    expect(result.fieldErrors).toEqual({
      sections: SELECT_SECTIONS_MESSAGE,
      reason: ENTER_REASON_MESSAGE
    })
    expect(result.values).toEqual({ sections: [], reason: '' })
  })

  test('tolerates a null payload', () => {
    const result = validateQueryForm(null)
    expect(result.ok).toBe(false)
    expect(result.values).toEqual({ sections: [], reason: '' })
  })
})
