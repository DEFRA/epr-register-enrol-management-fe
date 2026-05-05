import { afterEach, describe, expect, test, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

import { _clearJwksCache, verifyAzureIdToken } from './azure-id-token.js'

afterEach(() => {
  _clearJwksCache()
  vi.restoreAllMocks()
})

async function setupKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'test-key'
  jwk.alg = 'RS256'
  jwk.use = 'sig'
  return { privateKey, jwk }
}

function mockJwks(jwk) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return { keys: [jwk] }
      }
    }))
  )
}

const issuer = 'https://login.example/v2.0'
const audience = 'client-id'
const jwksUri = 'https://login.example/jwks'

async function makeIdToken(privateKey, claims = {}) {
  return new SignJWT({ nonce: 'expected', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

describe('verifyAzureIdToken', () => {
  test('returns claims when signature, iss, aud, exp and nonce are valid', async () => {
    const { privateKey, jwk } = await setupKeys()
    mockJwks(jwk)
    const tok = await makeIdToken(privateKey, { oid: 'u1' })

    const claims = await verifyAzureIdToken(tok, {
      jwksUri,
      issuer,
      audience,
      expectedNonce: 'expected'
    })

    expect(claims.oid).toBe('u1')
    expect(claims.nonce).toBe('expected')
  })

  test('throws when nonce does not match', async () => {
    const { privateKey, jwk } = await setupKeys()
    mockJwks(jwk)
    const tok = await makeIdToken(privateKey)

    await expect(
      verifyAzureIdToken(tok, {
        jwksUri,
        issuer,
        audience,
        expectedNonce: 'wrong'
      })
    ).rejects.toThrow(/nonce mismatch/)
  })

  test('throws when audience does not match', async () => {
    const { privateKey, jwk } = await setupKeys()
    mockJwks(jwk)
    const tok = await makeIdToken(privateKey)

    await expect(
      verifyAzureIdToken(tok, {
        jwksUri,
        issuer,
        audience: 'other-audience',
        expectedNonce: 'expected'
      })
    ).rejects.toThrow()
  })

  test('throws when issuer does not match', async () => {
    const { privateKey, jwk } = await setupKeys()
    mockJwks(jwk)
    const tok = await makeIdToken(privateKey)

    await expect(
      verifyAzureIdToken(tok, {
        jwksUri,
        issuer: 'https://attacker.example/v2.0',
        audience,
        expectedNonce: 'expected'
      })
    ).rejects.toThrow()
  })

  test('throws when token is expired', async () => {
    const { privateKey, jwk } = await setupKeys()
    mockJwks(jwk)
    const tok = await new SignJWT({ nonce: 'expected' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey)

    await expect(
      verifyAzureIdToken(tok, {
        jwksUri,
        issuer,
        audience,
        expectedNonce: 'expected'
      })
    ).rejects.toThrow()
  })

  test('throws when signed by an unrelated key (signature invalid)', async () => {
    const { jwk } = await setupKeys()
    const { privateKey: attackerKey } = await setupKeys()
    mockJwks(jwk)
    const tok = await makeIdToken(attackerKey)

    await expect(
      verifyAzureIdToken(tok, {
        jwksUri,
        issuer,
        audience,
        expectedNonce: 'expected'
      })
    ).rejects.toThrow()
  })
})
