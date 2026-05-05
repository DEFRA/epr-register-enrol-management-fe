import { createServer } from '#/server/server.js'

describe('#contentSecurityPolicy', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should set the CSP policy header', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(resp.headers['content-security-policy']).toBeDefined()
  })

  describe('connect-src directive', () => {
    let connectSrc

    beforeAll(async () => {
      const resp = await server.inject({ method: 'GET', url: '/' })
      const header = resp.headers['content-security-policy']
      const directive = header
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith('connect-src'))
      connectSrc = directive
    })

    test("contains 'self'", () => {
      expect(connectSrc).toMatch(/(^|\s)'self'(\s|$)/)
    })

    test("contains 'wss:' scheme token (with colon)", () => {
      expect(connectSrc).toMatch(/(^|\s)wss:(\s|$)/)
    })

    test("does not contain bare 'wss' without colon", () => {
      expect(connectSrc).not.toMatch(/(^|\s)wss(\s|$)/)
    })

    test("does not contain 'unsafe-inline'", () => {
      expect(connectSrc).not.toMatch(/'unsafe-inline'/)
    })

    test('does not contain wildcard *', () => {
      expect(connectSrc).not.toMatch(/(^|\s)\*(\s|$)/)
    })
  })
})
