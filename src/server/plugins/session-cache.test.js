import { sessionCache } from './session-cache.js'

describe('sessionCache cookieOptions', () => {
  test('pins isHttpOnly true', () => {
    expect(sessionCache.options.cookieOptions.isHttpOnly).toBe(true)
  })

  test("pins isSameSite to 'Lax' (required for OAuth cross-site callback)", () => {
    expect(sessionCache.options.cookieOptions.isSameSite).toBe('Lax')
  })

  test('keeps clearInvalid true', () => {
    expect(sessionCache.options.cookieOptions.clearInvalid).toBe(true)
  })
})
