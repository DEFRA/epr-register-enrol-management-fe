import { describe, expect, test } from 'vitest'

import { countWords } from './word-count.js'

describe('countWords', () => {
  test('returns 0 for non-string input', () => {
    expect(countWords(undefined)).toBe(0)
    expect(countWords(null)).toBe(0)
    expect(countWords(42)).toBe(0)
    expect(countWords(['a', 'b'])).toBe(0)
  })

  test('returns 0 for empty and whitespace-only strings', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
    expect(countWords('\n\t  \r\n')).toBe(0)
  })

  test('counts single words regardless of surrounding whitespace', () => {
    expect(countWords('word')).toBe(1)
    expect(countWords('   word   ')).toBe(1)
  })

  test('collapses runs of whitespace between words', () => {
    expect(countWords('one two three')).toBe(3)
    expect(countWords('one    two\t\tthree\n\nfour')).toBe(4)
  })

  test('treats punctuation as part of the adjoining word', () => {
    expect(countWords('hello, world!')).toBe(2)
    expect(countWords('well-known re-accreditation')).toBe(2)
  })

  test('counts exactly at typical limits', () => {
    const twoHundred = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ')
    expect(countWords(twoHundred)).toBe(200)
    expect(countWords(`${twoHundred} extra`)).toBe(201)
  })
})
