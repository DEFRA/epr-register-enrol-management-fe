import { redirectToLogin } from './auth-redirect.js'

describe('redirectToLogin', () => {
  const h = {
    continue: Symbol('continue'),
    redirect: (url) => ({ redirected: url })
  }

  test('passes through when response is not a Boom error', () => {
    const request = { response: { isBoom: false } }
    expect(redirectToLogin(request, h)).toBe(h.continue)
  })

  test('passes through for non-401 Boom errors', () => {
    const request = {
      response: { isBoom: true, output: { statusCode: 403 } }
    }
    expect(redirectToLogin(request, h)).toBe(h.continue)
  })

  test('redirects to /auth/regulator/login on 401', () => {
    const request = {
      response: { isBoom: true, output: { statusCode: 401 } }
    }
    expect(redirectToLogin(request, h)).toEqual({
      redirected: '/auth/regulator/login'
    })
  })
})
