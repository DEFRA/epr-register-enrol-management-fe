import hapi from '@hapi/hapi'
import { vi } from 'vitest'

/**
 * router.js branches on config.get('isProduction')/config.get('isTest') to
 * decide between two totally different static-asset strategies:
 *  - dev: mount a Vite dev server in middleware mode behind a catch-all
 *    '/public/{param*}' route (so unbuilt frontend assets are served with
 *    HMR).
 *  - prod/test: register the pre-built serveStaticFiles plugin.
 *
 * The whole suite runs with NODE_ENV=test, so only the second path is ever
 * exercised by the rest of the tests (via createServer()). This file mocks
 * config, vite and connect so the dev-only branch — including the actual
 * request handler that bridges a hapi request into Vite's connect
 * middleware — gets deterministic, isolated coverage.
 */

const overrides = {
  isProduction: false,
  isTest: false
}

vi.mock('#/config/config.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    config: {
      get: (key) =>
        Object.hasOwn(overrides, key) ? overrides[key] : actual.config.get(key)
    }
  }
})

const viteMiddlewares = vi.fn()
const createViteServerMock = vi.fn(async () => ({
  middlewares: viteMiddlewares
}))
vi.mock('vite', () => ({
  createServer: (...args) => createViteServerMock(...args)
}))

// `connect()` returns a request handler function with a `.use()` method;
// tests control the handler's behaviour per-case via this mock.
const connectAppMock = vi.fn()
connectAppMock.use = vi.fn()
vi.mock('connect', () => ({
  default: () => connectAppMock
}))

const { router, createViteMiddlewareHandler } = await import('./router.js')

function setConfig(values) {
  Object.assign(overrides, values)
}

// router.js registers routes that require auth (e.g. /backend-status), so a
// default strategy has to exist for registration to succeed — same as in
// the real app, where the auth plugin is registered ahead of the router.
async function buildServer() {
  const server = hapi.server()
  server.auth.scheme('always', () => ({
    authenticate(_request, h) {
      return h.authenticated({ credentials: { scope: ['support-readonly'] } })
    }
  }))
  server.auth.strategy('session', 'always')
  server.auth.default('session')
  await server.register(router)
  return server
}

describe('router (production/prod-like config)', () => {
  beforeEach(() => {
    setConfig({ isProduction: false, isTest: false })
    createViteServerMock.mockClear()
    connectAppMock.mockReset()
  })

  test('mounts a Vite dev server and registers the catch-all /public route', async () => {
    connectAppMock.mockImplementation((_req, _res, next) => next())

    const server = await buildServer()

    expect(createViteServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        server: { middlewareMode: true },
        appType: 'custom'
      })
    )
    const table = server.table()
    expect(
      table.some(
        (route) => route.path === '/public/{param*}' && route.method === '*'
      )
    ).toBe(true)
  })

  test('responds 404 when the connect app calls next() without ending the response', async () => {
    connectAppMock.mockImplementation((_req, _res, next) => next())

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/public/missing.js'
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('createViteMiddlewareHandler', () => {
  function fakeH() {
    const codeMock = vi.fn().mockReturnThis()
    return {
      abandon: Symbol('abandon'),
      codeMock,
      response: vi.fn(() => ({ code: codeMock }))
    }
  }

  test('responds 404 when the connect app declines the request via next()', async () => {
    const app = vi.fn((_req, _res, next) => next())
    const finished = vi.fn(() => new Promise(() => {})) // never resolves
    const h = fakeH()
    const request = { raw: { req: {}, res: {} } }

    await createViteMiddlewareHandler(app, finished)(request, h)

    expect(h.response).toHaveBeenCalled()
    expect(h.codeMock).toHaveBeenCalledWith(404)
  })

  // The handler races finished(res) against the connect app calling next().
  // When Vite has already written and ended the response itself (no next()
  // call), finished(res) wins and the handler must hand the response back
  // via h.abandon rather than emitting its own reply on top of it.
  test('returns h.abandon when the response finishes without next() being called', async () => {
    const app = vi.fn() // never calls next
    const finished = vi.fn().mockResolvedValue(undefined)
    const h = fakeH()
    const request = { raw: { req: {}, res: {} } }

    const result = await createViteMiddlewareHandler(app, finished)(request, h)

    expect(result).toBe(h.abandon)
    expect(h.response).not.toHaveBeenCalled()
  })
})

describe('router (test config)', () => {
  beforeEach(() => {
    setConfig({ isProduction: false, isTest: true })
    createViteServerMock.mockClear()
  })

  test('does not start a Vite server and registers the static files plugin instead', async () => {
    const server = await buildServer()

    expect(createViteServerMock).not.toHaveBeenCalled()
    const table = server.table()
    // serveStaticFiles registers its own directory route under the same
    // asset path, but never a catch-all '*' method route — that's unique to
    // the Vite dev branch.
    expect(table.some((route) => route.method === '*')).toBe(false)
    expect(table.some((route) => route.path === '/favicon.ico')).toBe(true)
  })
})
