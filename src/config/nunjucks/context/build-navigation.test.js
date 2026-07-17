import { buildNavigation } from './build-navigation.js'

function mockRequest(options) {
  return { ...options }
}

describe('#buildNavigation', () => {
  test('Should provide expected navigation details', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([
      { current: false, text: 'Work items', href: '/work-items' },
      { current: false, text: 'Backend status', href: '/backend-status' }
    ])
  })

  test('Should highlight backend status when on /backend-status', () => {
    expect(buildNavigation(mockRequest({ path: '/backend-status' }))).toEqual([
      { current: false, text: 'Work items', href: '/work-items' },
      { current: true, text: 'Backend status', href: '/backend-status' }
    ])
  })

  test('Should highlight work items when on /work-items', () => {
    expect(buildNavigation(mockRequest({ path: '/work-items' }))).toEqual([
      { current: true, text: 'Work items', href: '/work-items' },
      { current: false, text: 'Backend status', href: '/backend-status' }
    ])
  })
})
