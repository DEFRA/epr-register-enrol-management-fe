import { vi } from 'vitest'

const configValues = {
  isProduction: false,
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
  test('selects the production authPlugin when isProduction is true', () => {
    setConfig({
      isProduction: true,
      isTest: false,
      'auth.stubEnabled': false
    })
    expect(selectAuthPlugin()).toBe(authPlugin)
    expect(selectAuthPlugin()).not.toBe(stubAuthPlugin)
  })

  test('production never selects the stub even if stubEnabled is true', () => {
    setConfig({
      isProduction: true,
      isTest: false,
      'auth.stubEnabled': true
    })
    expect(selectAuthPlugin()).toBe(authPlugin)
  })

  test('selects the stub plugin when stubEnabled is true outside prod', () => {
    setConfig({
      isProduction: false,
      isTest: false,
      'auth.stubEnabled': true
    })
    expect(selectAuthPlugin()).toBe(stubAuthPlugin)
  })

  test('selects the stub plugin when isTest is true', () => {
    setConfig({
      isProduction: false,
      isTest: true,
      'auth.stubEnabled': false
    })
    expect(selectAuthPlugin()).toBe(stubAuthPlugin)
  })

  test('falls back to authPlugin when neither stubEnabled nor isTest is true', () => {
    setConfig({
      isProduction: false,
      isTest: false,
      'auth.stubEnabled': false
    })
    expect(selectAuthPlugin()).toBe(authPlugin)
  })
})
