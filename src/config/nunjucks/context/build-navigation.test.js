import { buildNavigation } from './build-navigation.js'

function mockRequest(options) {
  return { ...options }
}

describe('#buildNavigation', () => {
  // RA-324. The nav items carry stable data-testid attributes for the e2e
  // suite (AC01/AC03); the "Work items" link text is unchanged.
  const workItems = (current) => ({
    current,
    text: 'Work items',
    href: '/work-items',
    attributes: { 'data-testid': 'nav-work-items' }
  })
  const backendStatus = (current) => ({
    current,
    text: 'Backend status',
    href: '/backend-status',
    attributes: { 'data-testid': 'nav-backend-status' }
  })

  test('Should provide expected navigation details', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([workItems(false), backendStatus(false)])
  })

  test('Should highlight backend status when on /backend-status', () => {
    expect(buildNavigation(mockRequest({ path: '/backend-status' }))).toEqual([
      workItems(false),
      backendStatus(true)
    ])
  })

  test('Should highlight work items when on /work-items', () => {
    expect(buildNavigation(mockRequest({ path: '/work-items' }))).toEqual([
      workItems(true),
      backendStatus(false)
    ])
  })
})
