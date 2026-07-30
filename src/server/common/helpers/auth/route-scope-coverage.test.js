import { createServer } from '#/server/server.js'
import { ROLE_STANDARD } from './auth-scopes.js'

/**
 * RA-335 exists because five mutating routes had been registered with no
 * scope check at all — any authenticated session (including a future
 * read-only support user) could POST to them. Docs alone don't stop this
 * recurring: a contributor (human or agent) adding a new work-item action
 * has no reason to read the RA-335 auth notes unless something actively
 * tells them to. This test is that something — it walks the live route
 * table and fails the moment a mutating route is registered without
 * `requireStandard` (or an equivalent `standard`-only scope), rather than
 * relying on someone remembering to add it.
 *
 * `EXEMPT_ROUTES` is a closed, deliberately short list of routes that
 * legitimately mutate state (or accept a POST) without requiring the
 * `standard` role — because they're part of establishing that identity in
 * the first place, not an authenticated caseworker action. Add to it only
 * with the same justification.
 */
const EXEMPT_ROUTES = new Set([
  'POST /auth/stub/login' // the login mechanism itself — auth: false
])

describe('every mutating route requires the standard role', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('no POST/PUT/PATCH/DELETE route is reachable by an authenticated session that lacks ROLE_STANDARD, unless explicitly exempted', () => {
    const mutatingMethods = new Set(['post', 'put', 'patch', 'delete'])
    const offenders = []

    for (const route of server.table()) {
      if (!mutatingMethods.has(route.method)) {
        continue
      }

      const key = `${route.method.toUpperCase()} ${route.path}`
      if (EXEMPT_ROUTES.has(key)) {
        continue
      }

      const scopeSelection = route.settings.auth?.access?.[0]?.scope?.selection
      if (!scopeSelection || !scopeSelection.includes(ROLE_STANDARD)) {
        offenders.push(key)
      }
    }

    expect(offenders).toEqual([])
  })
})
