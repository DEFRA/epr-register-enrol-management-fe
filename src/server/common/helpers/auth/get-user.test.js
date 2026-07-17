import { getUser } from './get-user.js'

describe('get-user', () => {
  test('getUser returns credentials when present', () => {
    const request = { auth: { credentials: { id: 'a', roles: ['standard'] } } }
    expect(getUser(request)).toEqual({ id: 'a', roles: ['standard'] })
  })

  test('getUser returns null when no auth', () => {
    expect(getUser({})).toBeNull()
  })
})
