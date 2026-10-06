import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { cspOptions } from './content-security-policy.js'

function directive(header, name) {
  return header
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
}

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

describe('#cspOptions', () => {
  test('with analytics off, is exactly the policy the service has always served', () => {
    expect(cspOptions({ allowAnalytics: false })).toEqual({
      defaultSrc: ['self'],
      fontSrc: ['self', 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ['self', 'wss:', 'data:'],
      mediaSrc: ['self'],
      styleSrc: ['self', 'https://fonts.googleapis.com'],
      scriptSrc: [
        'self',
        "'sha256-GUQ5ad8JK5KmEWmROf3LZd9ge94daqNvd8xy9YS1iDw='"
      ],
      imgSrc: ['self', 'data:'],
      frameSrc: ['self', 'data:'],
      objectSrc: ['none'],
      frameAncestors: ['none'],
      formAction: ['self'],
      manifestSrc: ['self'],
      generateNonces: false
    })
  })

  test('with analytics on, adds the GA4 origins and widens nothing else', () => {
    const off = cspOptions({ allowAnalytics: false })
    const on = cspOptions({ allowAnalytics: true })

    expect(on).toEqual({
      ...off,
      connectSrc: [
        ...off.connectSrc,
        'https://*.google-analytics.com',
        'https://*.analytics.google.com',
        'https://www.googletagmanager.com'
      ],
      scriptSrc: [...off.scriptSrc, 'https://www.googletagmanager.com'],
      imgSrc: [...off.imgSrc, 'https://*.google-analytics.com']
    })
  })
})

describe('#contentSecurityPolicy with analytics', () => {
  const original = {
    isEnabled: config.get('analytics.isEnabled'),
    measurementId: config.get('analytics.measurementId')
  }

  afterEach(() => {
    config.set('analytics.isEnabled', original.isEnabled)
    config.set('analytics.measurementId', original.measurementId)
  })

  async function scriptSrcFor({ isEnabled, measurementId }) {
    // The policy is fixed when the server registers the plugin, so config
    // has to be in place before the server is created.
    config.set('analytics.isEnabled', isEnabled)
    config.set('analytics.measurementId', measurementId)
    const server = await createServer()
    await server.initialize()
    try {
      const resp = await server.inject({ method: 'GET', url: '/' })
      return directive(resp.headers['content-security-policy'], 'script-src')
    } finally {
      await server.stop({ timeout: 0 })
    }
  }

  test('allows Google Tag Manager when analytics is on', async () => {
    expect(
      await scriptSrcFor({ isEnabled: true, measurementId: 'G-TEST' })
    ).toContain('https://www.googletagmanager.com')
  })

  test.each([
    { isEnabled: false, measurementId: 'G-TEST' },
    { isEnabled: true, measurementId: '' }
  ])(
    'does not allow it for isEnabled=$isEnabled, measurementId="$measurementId"',
    async (settings) => {
      expect(await scriptSrcFor(settings)).not.toContain('googletagmanager')
    }
  )
})
