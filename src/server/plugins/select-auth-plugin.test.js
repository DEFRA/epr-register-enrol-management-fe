import { vi } from 'vitest'

const configValues = {
  isTest: false,
  'auth.stubEnabled': false
}

vi.mock('#/config/config.js', () => ({
  config: {
    get: (key) => configValues[key]
  }
}))

const { selectAuthPlugin } = await import('./select-auth-plugin.js')
const { authPlugin } = await import('../common/helpers/auth/auth-plugin.js')
const { stubAuthPlugin } =
  await import('../common/helpers/auth/stub-auth-plugin.js')

function setConfig(overrides) {
  Object.assign(configValues, overrides)
}

describe('selectAuthPlugin', () => {
  test('selects authPlugin when stub is disabled and not in test mode', () => {
    setConfig({ isTest: false, 'auth.stubEnabled': false })
    expect(selectAuthPlugin()).toBe(authPlugin)
    expect(selectAuthPlugin()).not.toBe(stubAuthPlugin)
  })

  test('selects stub plugin when stubEnabled is true', () => {
    setConfig({ isTest: false, 'auth.stubEnabled': true })
    expect(selectAuthPlugin()).toBe(stubAuthPlugin)
  })

  test('selects stub plugin when isTest is true', () => {
    setConfig({ isTest: true, 'auth.stubEnabled': false })
    expect(selectAuthPlugin()).toBe(stubAuthPlugin)
  })

  test('falls back to authPlugin when neither stubEnabled nor isTest is true', () => {
    setConfig({ isTest: false, 'auth.stubEnabled': false })
    expect(selectAuthPlugin()).toBe(authPlugin)
  })
})
