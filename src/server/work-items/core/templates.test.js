import { describe, expect, test, beforeEach } from 'vitest'

import {
  clearDetailTemplateRegistry,
  registerDetailTemplate,
  registerModuleDetailTemplates,
  resolveDetailTemplate
} from './templates.js'

describe('#detail template registry', () => {
  beforeEach(() => {
    clearDetailTemplateRegistry()
  })

  test('Resolves a registered template for a (typeId, version) pair', () => {
    registerDetailTemplate('re-accreditation', 'v1', 're-accreditation/detail-v1')

    expect(resolveDetailTemplate('re-accreditation', 'v1')).toBe(
      're-accreditation/detail-v1'
    )
  })

  test('Falls back to the generic template when the pair is unknown', () => {
    expect(resolveDetailTemplate('unknown', 'v9')).toBe('work-items/detail')
  })

  test('Falls back to the generic template when typeId or version is missing', () => {
    expect(resolveDetailTemplate(null, 'v1')).toBe('work-items/detail')
    expect(resolveDetailTemplate('re-accreditation', null)).toBe(
      'work-items/detail'
    )
  })

  test('Different versions of the same type resolve to different templates', () => {
    registerDetailTemplate('re-accreditation', 'v1', 're-accreditation/detail-v1')
    registerDetailTemplate('re-accreditation', 'v2', 're-accreditation/detail-v2')

    expect(resolveDetailTemplate('re-accreditation', 'v1')).toBe(
      're-accreditation/detail-v1'
    )
    expect(resolveDetailTemplate('re-accreditation', 'v2')).toBe(
      're-accreditation/detail-v2'
    )
  })

  test('Module helper registers every version in one go', () => {
    registerModuleDetailTemplates('re-accreditation', {
      v1: 're-accreditation/detail-v1',
      v2: 're-accreditation/detail-v2'
    })

    expect(resolveDetailTemplate('re-accreditation', 'v1')).toBe(
      're-accreditation/detail-v1'
    )
    expect(resolveDetailTemplate('re-accreditation', 'v2')).toBe(
      're-accreditation/detail-v2'
    )
  })

  test('Throws on missing or empty arguments', () => {
    expect(() => registerDetailTemplate('', 'v1', 'x')).toThrow(/typeId/)
    expect(() => registerDetailTemplate('t', '', 'x')).toThrow(/templateVersion/)
    expect(() => registerDetailTemplate('t', 'v1', '')).toThrow(/non-empty/)
  })
})
