import { buildPaymentReceivedRoutes } from './routes.js'

describe('#buildPaymentReceivedRoutes (RA-523)', () => {
  test('mounts exactly one POST route on the type-specific path', () => {
    const routes = buildPaymentReceivedRoutes()

    expect(routes).toHaveLength(1)
    expect(routes[0].method).toBe('POST')
    // The path carries NO action id. That is the security boundary: the
    // underlying transition shares `fromStateId: 'updated'` with all four
    // continue-review hops, so a caller-named action could send a
    // `submitted`-origin item past duly making, its payment date and its
    // SLA clock. The endpoint IS the action.
    expect(routes[0].path).toBe(
      '/work-items/re-accreditation/{id}/payment-received'
    )
  })

  test('is GET-less — there is no interstitial to render', () => {
    expect(buildPaymentReceivedRoutes().map((r) => r.method)).toEqual(['POST'])
  })

  test('requires authentication but NOT the assign role', () => {
    const [route] = buildPaymentReceivedRoutes()

    // Mirrors management-be, which protects this with plain authorisation:
    // any authenticated case worker may record it, with no assigned-officer
    // check. Asserted rather than assumed — silently widening this to
    // `requireAssign` would lock out the standard caseworkers the journey
    // is for, and silently dropping it would let an anonymous POST through.
    expect(route.options.auth).toBeDefined()
    expect(JSON.stringify(route.options.auth)).not.toContain('assign')
  })

  test('parses a form post and caps the body', () => {
    const [route] = buildPaymentReceivedRoutes()

    expect(route.options.payload).toEqual({
      parse: true,
      allow: 'application/x-www-form-urlencoded',
      maxBytes: 10 * 1024
    })
  })

  test('wires a handler', () => {
    expect(typeof buildPaymentReceivedRoutes()[0].handler).toBe('function')
  })
})
