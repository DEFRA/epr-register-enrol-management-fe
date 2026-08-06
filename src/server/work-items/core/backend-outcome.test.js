import { describe, expect, test } from 'vitest'

import {
  FALLBACK_OUTCOME,
  KNOWN_OUTCOMES,
  toOutcome
} from './backend-outcome.js'

describe('toOutcome (RA-372)', () => {
  test.each([
    'invalid',
    'unauthorized',
    'forbidden',
    'not-found',
    'conflict',
    'server',
    'network'
  ])('passes the known reason %s through unchanged', (reason) => {
    expect(toOutcome(reason)).toBe(reason)
  })

  test('covers every reason the backend clients can produce', () => {
    // Pinned as a set rather than asserted one at a time, so a reason
    // added to `backend-api.js` without a matching entry here shows up as
    // a failure instead of silently degrading every caller to 'server'.
    expect([...KNOWN_OUTCOMES].sort()).toEqual([
      'conflict',
      'forbidden',
      'invalid',
      'network',
      'not-found',
      'server',
      'unauthorized'
    ])
  })

  test.each([
    ['something-new'],
    [''],
    [undefined],
    [null],
    [42],
    [{ reason: 'conflict' }]
  ])('degrades the unrecognised reason %s to the fallback', (reason) => {
    expect(toOutcome(reason)).toBe(FALLBACK_OUTCOME)
  })

  test('the fallback is the generic server outcome', () => {
    // Controllers render a "try again" banner for this, which is the
    // right default for a failure the frontend cannot interpret.
    expect(FALLBACK_OUTCOME).toBe('server')
  })

  test('does not inherit matches from Object.prototype', () => {
    // A plain-object lookup would resolve 'constructor' / 'toString' to
    // something truthy; the Set does not. Guards the reason this is a Set
    // rather than the object map it replaced.
    expect(toOutcome('constructor')).toBe(FALLBACK_OUTCOME)
    expect(toOutcome('toString')).toBe(FALLBACK_OUTCOME)
    expect(toOutcome('hasOwnProperty')).toBe(FALLBACK_OUTCOME)
  })
})
