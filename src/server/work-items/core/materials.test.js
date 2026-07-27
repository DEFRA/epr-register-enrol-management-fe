import { describe, test, expect } from 'vitest'

import {
  MATERIAL_FILTER_OPTIONS,
  MATERIAL_TOKENS,
  materialLabel
} from './materials.js'

describe('materials', () => {
  test('exposes the canonical token list in prototype order', () => {
    expect(MATERIAL_TOKENS).toEqual([
      'aluminium',
      'fibre',
      'glass',
      'paper',
      'plastic',
      'steel',
      'wood'
    ])
    // Options carry a display label per token.
    expect(MATERIAL_FILTER_OPTIONS).toContainEqual({
      value: 'fibre',
      text: 'Fibre-based composite material'
    })
    expect(MATERIAL_FILTER_OPTIONS).toContainEqual({
      value: 'paper',
      text: 'Paper or board'
    })
  })

  describe('#materialLabel', () => {
    test('maps a known token to its display label', () => {
      expect(materialLabel('plastic')).toBe('Plastic')
      expect(materialLabel('fibre')).toBe('Fibre-based composite material')
    })

    test('matches case-insensitively', () => {
      expect(materialLabel('PLASTIC')).toBe('Plastic')
      expect(materialLabel('Glass')).toBe('Glass')
    })

    test('returns the original value for an unrecognised token', () => {
      expect(materialLabel('unobtanium')).toBe('unobtanium')
    })

    test('returns null for an absent value', () => {
      expect(materialLabel(null)).toBeNull()
      expect(materialLabel(undefined)).toBeNull()
      expect(materialLabel('')).toBeNull()
    })
  })
})
