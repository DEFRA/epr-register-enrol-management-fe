import { describe, expect, test } from 'vitest'

import {
  ACCOMPANYING_CODE_MESSAGE,
  ALL_CODES,
  CODES_BY_MATERIAL_TYPE,
  CODES_REQUIRING_ACCOMPANIMENT,
  INTERIM_SITE_REQUIRED_MESSAGE,
  RECYCLING_OPERATION_LABELS,
  SELECT_CODES_MESSAGE,
  applicableCodesForMaterialType,
  buildErrorSummary,
  joiDetailsToFieldErrors,
  normaliseCodes,
  recyclingOperationLabel,
  requiresAccompanyingCode,
  requiresInterimSite,
  validateRecyclingOperationsForm
} from './recycling-operations.schema.js'

describe('ALL_CODES / RECYCLING_OPERATION_LABELS', () => {
  test('is the full five-code set', () => {
    expect(ALL_CODES).toEqual(['R3', 'R4', 'R5', 'R12', 'R13'])
  })

  test('every code has a human-readable label', () => {
    for (const code of ALL_CODES) {
      expect(RECYCLING_OPERATION_LABELS[code]).toEqual(expect.any(String))
      expect(RECYCLING_OPERATION_LABELS[code]).toContain(code)
    }
  })

  test('recyclingOperationLabel resolves a known code and falls back to the raw value otherwise', () => {
    expect(recyclingOperationLabel('R3')).toContain(
      'Recycling/reclamation of organic substances'
    )
    expect(recyclingOperationLabel('unknown')).toBe('unknown')
  })
})

describe('CODES_BY_MATERIAL_TYPE', () => {
  test('matches the agreed per-material code sets, keyed lowercase', () => {
    expect(CODES_BY_MATERIAL_TYPE).toEqual({
      aluminium: ['R4', 'R12', 'R13'],
      fibre: ['R3', 'R5', 'R12', 'R13'],
      glass: ['R5', 'R12', 'R13'],
      paper: ['R3', 'R12', 'R13'],
      plastic: ['R3', 'R12', 'R13'],
      steel: ['R4', 'R12', 'R13'],
      wood: ['R3', 'R12', 'R13']
    })
  })
})

describe('applicableCodesForMaterialType', () => {
  test('resolves each material token to its code set', () => {
    expect(applicableCodesForMaterialType('glass')).toEqual([
      'R5',
      'R12',
      'R13'
    ])
    expect(applicableCodesForMaterialType('plastic')).toEqual([
      'R3',
      'R12',
      'R13'
    ])
  })

  test('is case-insensitive', () => {
    expect(applicableCodesForMaterialType('Glass')).toEqual([
      'R5',
      'R12',
      'R13'
    ])
  })

  test('falls back to the full set for a missing or unrecognised token', () => {
    expect(applicableCodesForMaterialType(undefined)).toEqual(ALL_CODES)
    expect(applicableCodesForMaterialType('')).toEqual(ALL_CODES)
    expect(applicableCodesForMaterialType('not-a-material')).toEqual(ALL_CODES)
  })
})

describe('requiresAccompanyingCode', () => {
  test('true when only R12/R13 codes are present', () => {
    expect(requiresAccompanyingCode(['R12'])).toBe(true)
    expect(requiresAccompanyingCode(['R13'])).toBe(true)
    expect(requiresAccompanyingCode(['R12', 'R13'])).toBe(true)
  })

  test('false when at least one of R3/R4/R5 accompanies R12/R13', () => {
    expect(requiresAccompanyingCode(['R3', 'R12'])).toBe(false)
    expect(requiresAccompanyingCode(['R4', 'R13'])).toBe(false)
  })

  test('false when no accompaniment-requiring code is present', () => {
    expect(requiresAccompanyingCode(['R3', 'R4'])).toBe(false)
    expect(requiresAccompanyingCode([])).toBe(false)
  })
})

describe('requiresInterimSite', () => {
  test('true whenever R12 or R13 is present', () => {
    expect(requiresInterimSite(['R12'])).toBe(true)
    expect(requiresInterimSite(['R3', 'R13'])).toBe(true)
  })

  test('false when neither R12 nor R13 is present', () => {
    expect(requiresInterimSite(['R3', 'R4', 'R5'])).toBe(false)
    expect(requiresInterimSite([])).toBe(false)
  })
})

describe('CODES_REQUIRING_ACCOMPANIMENT', () => {
  test('is exactly R12 and R13', () => {
    expect(CODES_REQUIRING_ACCOMPANIMENT.has('R12')).toBe(true)
    expect(CODES_REQUIRING_ACCOMPANIMENT.has('R13')).toBe(true)
    expect(CODES_REQUIRING_ACCOMPANIMENT.has('R3')).toBe(false)
  })
})

describe('normaliseCodes', () => {
  test('wraps a single string selection into an array', () => {
    expect(normaliseCodes('R3')).toEqual(['R3'])
  })

  test('treats an empty string as no selection', () => {
    expect(normaliseCodes('')).toEqual([])
  })

  test('passes arrays through, dropping empty and non-string entries', () => {
    expect(normaliseCodes(['R3', '', 'R4', null, 42])).toEqual(['R3', 'R4'])
  })

  test('treats null/undefined as no selection', () => {
    expect(normaliseCodes(null)).toEqual([])
    expect(normaliseCodes(undefined)).toEqual([])
  })
})

describe('joiDetailsToFieldErrors', () => {
  test('keeps only the first error per field', () => {
    const details = [
      { path: ['codes'], message: 'first' },
      { path: ['codes'], message: 'second' }
    ]
    expect(joiDetailsToFieldErrors(details)).toEqual({ codes: 'first' })
  })

  test('handles a missing/undefined details array', () => {
    expect(joiDetailsToFieldErrors(undefined)).toEqual({})
  })
})

describe('buildErrorSummary', () => {
  test('returns null when there are no field errors', () => {
    expect(buildErrorSummary({})).toBeNull()
  })

  test('anchors to #field-codes', () => {
    expect(buildErrorSummary({ codes: SELECT_CODES_MESSAGE })).toEqual({
      titleText: 'There is a problem',
      items: [{ text: SELECT_CODES_MESSAGE, href: '#field-codes' }]
    })
  })
})

describe('validateRecyclingOperationsForm', () => {
  test('AC12: rejects zero codes', () => {
    const result = validateRecyclingOperationsForm({ codes: [] })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.codes).toBe(SELECT_CODES_MESSAGE)
    expect(result.values).toEqual({ codes: [] })
  })

  test('AC12: rejects a payload with no codes field at all', () => {
    const result = validateRecyclingOperationsForm({})
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.codes).toBe(SELECT_CODES_MESSAGE)
  })

  test('rejects a code outside the applicable set for the material type', () => {
    const result = validateRecyclingOperationsForm(
      { codes: ['R4'] },
      { applicableCodes: ['R5', 'R12', 'R13'], hasInterimSite: true }
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.codes).toBe(SELECT_CODES_MESSAGE)
  })

  test('AC10: rejects R12/R13 without an accompanying R3/R4/R5', () => {
    const result = validateRecyclingOperationsForm(
      { codes: ['R12'] },
      { hasInterimSite: true }
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.codes).toBe(ACCOMPANYING_CODE_MESSAGE)
  })

  test('AC11: rejects R12/R13 for a site with no associated interim site', () => {
    const result = validateRecyclingOperationsForm(
      { codes: ['R3', 'R12'] },
      { hasInterimSite: false }
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.codes).toBe(INTERIM_SITE_REQUIRED_MESSAGE)
  })

  test('accepts R3/R4/R5-only codes with no interim site required', () => {
    const result = validateRecyclingOperationsForm(
      { codes: ['R3', 'R4'] },
      { hasInterimSite: false }
    )
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ codes: ['R3', 'R4'] })
  })

  test('accepts R12/R13 alongside R3/R4/R5 when an interim site exists', () => {
    const result = validateRecyclingOperationsForm(
      { codes: ['R5', 'R12', 'R13'] },
      { applicableCodes: ['R5', 'R12', 'R13'], hasInterimSite: true }
    )
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ codes: ['R5', 'R12', 'R13'] })
  })

  test('normalises a single checked checkbox posted as a bare string', () => {
    const result = validateRecyclingOperationsForm(
      { codes: 'R3' },
      { hasInterimSite: false }
    )
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ codes: ['R3'] })
  })

  test('defaults applicableCodes to the full set and hasInterimSite to false', () => {
    const result = validateRecyclingOperationsForm({ codes: ['R3'] })
    expect(result.ok).toBe(true)
  })
})
