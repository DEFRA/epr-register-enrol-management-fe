import { getUser, hasRole } from './get-user.js'

describe('get-user', () => {
  test('getUser returns credentials when present', () => {
    const request = { auth: { credentials: { id: 'a', roles: ['standard'] } } }
    expect(getUser(request)).toEqual({ id: 'a', roles: ['standard'] })
  })

  test('getUser returns null when no auth', () => {
    expect(getUser({})).toBeNull()
  })

  test('hasRole returns true when role present', () => {
    const request = { auth: { credentials: { roles: ['standard', 'assign'] } } }
    expect(hasRole(request, 'assign')).toBe(true)
  })

  test('hasRole returns false when role missing', () => {
    const request = { auth: { credentials: { roles: ['standard'] } } }
    expect(hasRole(request, 'assign')).toBe(false)
  })

  test('hasRole returns false when no roles', () => {
    expect(hasRole({}, 'standard')).toBe(false)
  })
})
