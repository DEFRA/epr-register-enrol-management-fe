import { buildNavigation } from './build-navigation.js'

function mockRequest(options) {
  return { ...options }
}

describe('#buildNavigation', () => {
  test('Should provide expected navigation details', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([
      { current: false, text: 'Home', href: '/' },
      { current: false, text: 'About', href: '/about' },
      { current: false, text: 'Backend status', href: '/backend-status' }
    ])
  })

  test('Should provide expected highlighted navigation details', () => {
    expect(buildNavigation(mockRequest({ path: '/' }))).toEqual([
      { current: true, text: 'Home', href: '/' },
      { current: false, text: 'About', href: '/about' },
      { current: false, text: 'Backend status', href: '/backend-status' }
    ])
  })

  test('Should highlight backend status when on /backend-status', () => {
    expect(
      buildNavigation(mockRequest({ path: '/backend-status' }))
    ).toEqual([
      { current: false, text: 'Home', href: '/' },
      { current: false, text: 'About', href: '/about' },
      { current: true, text: 'Backend status', href: '/backend-status' }
    ])
  })
})
