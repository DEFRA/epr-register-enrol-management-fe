import { buildNavigation } from './build-navigation.js'
import {
  ROLE_STANDARD,
  ROLE_SUPPORT_READONLY
} from '#/server/common/helpers/auth/auth-scopes.js'

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

  test('omits Backend status for a signed-out visitor', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([workItems(false)])
  })

  test('omits Backend status for a caseworker (standard role)', () => {
    expect(
      buildNavigation(
        mockRequest({
          path: '/work-items',
          auth: { credentials: { roles: [ROLE_STANDARD] } }
        })
      )
    ).toEqual([workItems(true)])
  })

  // RA-335: the backend-status diagnostic page is a support-user tool.
  test('includes Backend status for a signed-in support user', () => {
    expect(
      buildNavigation(
        mockRequest({
          path: '/non-existent-path',
          auth: { credentials: { roles: [ROLE_SUPPORT_READONLY] } }
        })
      )
    ).toEqual([workItems(false), backendStatus(false)])
  })

  test('highlights Backend status when a support user is on /backend-status', () => {
    expect(
      buildNavigation(
        mockRequest({
          path: '/backend-status',
          auth: { credentials: { roles: [ROLE_SUPPORT_READONLY] } }
        })
      )
    ).toEqual([workItems(false), backendStatus(true)])
  })

  test('highlights Work items when a support user is on /work-items', () => {
    expect(
      buildNavigation(
        mockRequest({
          path: '/work-items',
          auth: { credentials: { roles: [ROLE_SUPPORT_READONLY] } }
        })
      )
    ).toEqual([workItems(true), backendStatus(false)])
  })
})
