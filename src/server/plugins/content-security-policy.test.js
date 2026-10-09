import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { cspOptions } from './content-security-policy.js'
import { analyticsOrigins } from '../common/analytics/origins.js'

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

// A source that names a host: anything other than a quoted keyword
// ('self', 'none', a hash) or a bare scheme (data:, wss:).
const isHostSource = (source) =>
  !/^'.*'$/.test(source) &&
  !/^[a-z]+:$/.test(source) &&
  !/^(self|none)$/.test(source)

const hostSources = (options) =>
  Object.entries(options)
    .filter(([, sources]) => Array.isArray(sources))
    .flatMap(([name, sources]) =>
      sources.filter(isHostSource).map((source) => `${name} ${source}`)
    )

describe('#cspOptions', () => {
  // Every third-party origin a page talks to receives the user's IP address,
  // which is a personal-data transfer under UK GDPR. The CSP is what stops the
  // browser making those requests, so it must not allow any host except the
  // Google Analytics ones, which only load after cookie consent. Self-host the
  // asset instead of adding its origin here.
  test('with analytics off, allows no third-party origin at all', () => {
    expect(hostSources(cspOptions({ allowAnalytics: false }))).toEqual([])
  })

  test('with analytics on, the only third-party origins are the analytics ones', () => {
    const allowed = [
      ...analyticsOrigins.connect.map((o) => `connectSrc ${o}`),
      ...analyticsOrigins.script.map((o) => `scriptSrc ${o}`),
      ...analyticsOrigins.img.map((o) => `imgSrc ${o}`)
    ]
    expect(hostSources(cspOptions({ allowAnalytics: true })).sort()).toEqual(
      allowed.sort()
    )
  })

  test('with analytics off, is exactly the policy the service has always served', () => {
    expect(cspOptions({ allowAnalytics: false })).toEqual({
      defaultSrc: ['self'],
      fontSrc: ['self', 'data:'],
      connectSrc: ['self', 'wss:', 'data:'],
      mediaSrc: ['self'],
      styleSrc: ['self'],
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

  test('with analytics on, adds the Tag Manager and GA4 origins and widens nothing else', () => {
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
    gtmContainerId: config.get('analytics.gtmContainerId')
  }

  afterEach(() => {
    config.set('analytics.isEnabled', original.isEnabled)
    config.set('analytics.gtmContainerId', original.gtmContainerId)
  })

  async function scriptSrcFor({ isEnabled, gtmContainerId }) {
    // The policy is fixed when the server registers the plugin, so config
    // has to be in place before the server is created.
    config.set('analytics.isEnabled', isEnabled)
    config.set('analytics.gtmContainerId', gtmContainerId)
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
      await scriptSrcFor({ isEnabled: true, gtmContainerId: 'GTM-TEST' })
    ).toContain('https://www.googletagmanager.com')
  })

  test.each([
    { isEnabled: false, gtmContainerId: 'GTM-TEST' },
    { isEnabled: true, gtmContainerId: '' }
  ])(
    'does not allow it for isEnabled=$isEnabled, gtmContainerId="$gtmContainerId"',
    async (settings) => {
      expect(await scriptSrcFor(settings)).not.toContain('googletagmanager')
    }
  )
})
