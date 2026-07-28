import { describe, test, expect } from 'vitest'

import {
  MATERIAL_FILTER_OPTIONS,
  MATERIAL_TOKENS,
  materialLabel,
  materialFilterLabel,
  toBackendMaterialTokens
} from './materials.js'

describe('materials', () => {
  test('exposes the canonical filter token list in prototype order', () => {
    expect(MATERIAL_TOKENS).toEqual([
      'aluminium',
      'fibre',
      'glass-other',
      'glass-remelt',
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
    // RA-299 AC05: the single "Glass" checkbox is split into two.
    expect(MATERIAL_FILTER_OPTIONS).toContainEqual({
      value: 'glass-remelt',
      text: 'Glass- remelt'
    })
    expect(MATERIAL_FILTER_OPTIONS).toContainEqual({
      value: 'glass-other',
      text: 'Glass- other'
    })
    expect(MATERIAL_FILTER_OPTIONS).not.toContainEqual(
      expect.objectContaining({ value: 'glass' })
    )
  })

  describe('#materialLabel (raw backend payload token)', () => {
    test('maps a known token to its display label', () => {
      expect(materialLabel('plastic')).toBe('Plastic')
      expect(materialLabel('fibre')).toBe('Fibre-based composite material')
    })

    test('matches case-insensitively', () => {
      expect(materialLabel('PLASTIC')).toBe('Plastic')
      expect(materialLabel('Glass')).toBe('Glass')
    })

    // RA-299 AC05: the operator backend's MaterialType enum has only ONE
    // `Glass` value — a work item payload can never actually store
    // 'glass-remelt' / 'glass-other', but materialLabel must still resolve
    // the real 'glass' token to its generic "Glass" label unaffected by the
    // filter-checkbox split (see materials.js for the full reasoning).
    test('the real "glass" backend token still labels as "Glass"', () => {
      expect(materialLabel('glass')).toBe('Glass')
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

  describe('#materialFilterLabel (UI filter value)', () => {
    test('labels the split glass filter values distinctly', () => {
      expect(materialFilterLabel('glass-remelt')).toBe('Glass- remelt')
      expect(materialFilterLabel('glass-other')).toBe('Glass- other')
    })

    test('labels a non-split value the same as its filter option text', () => {
      expect(materialFilterLabel('plastic')).toBe('Plastic')
    })

    test('returns the original value for an unrecognised filter value', () => {
      expect(materialFilterLabel('unobtanium')).toBe('unobtanium')
    })
  })

  describe('#toBackendMaterialTokens', () => {
    test('maps both glass filter values to the single real backend token', () => {
      expect(toBackendMaterialTokens(['glass-remelt'])).toEqual(['glass'])
      expect(toBackendMaterialTokens(['glass-other'])).toEqual(['glass'])
    })

    test('dedupes when both glass filter values are selected together', () => {
      expect(toBackendMaterialTokens(['glass-remelt', 'glass-other'])).toEqual([
        'glass'
      ])
    })

    test('passes non-split tokens through unchanged', () => {
      expect(toBackendMaterialTokens(['plastic', 'steel'])).toEqual([
        'plastic',
        'steel'
      ])
    })

    test('mixes split and non-split tokens', () => {
      expect(
        toBackendMaterialTokens(['plastic', 'glass-remelt', 'glass-other'])
      ).toEqual(['plastic', 'glass'])
    })

    test('returns an empty array for no input', () => {
      expect(toBackendMaterialTokens([])).toEqual([])
    })
  })
})
