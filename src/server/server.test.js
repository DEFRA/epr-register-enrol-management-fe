import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const serverSource = readFileSync(path.join(dirname, 'server.js'), 'utf8')

describe('server wiring', () => {
  // ORDERING INVARIANT (epr-dn0): the undici proxy dispatcher must be
  // installed AFTER `@defra/hapi-secure-context` registers, so the CDP
  // CA bundle is loaded into Node's trust store before any outbound
  // TLS handshake. A direct integration test would require booting the
  // full server with a live proxy + secure context — instead we assert
  // the wiring order in source so a future refactor can't silently
  // re-introduce the bug.
  test('setupProxyEnv runs before secureContext is registered', () => {
    const setupEnvIdx = serverSource.indexOf('setupProxyEnv()')
    // Look for the secureContext usage inside the register([...]) array,
    // not the import statement at the top of the file.
    const registerIdx = serverSource.indexOf('server.register([')
    const secureContextInRegisterIdx = serverSource.indexOf(
      'secureContext',
      registerIdx
    )

    expect(setupEnvIdx).toBeGreaterThan(-1)
    expect(secureContextInRegisterIdx).toBeGreaterThan(-1)
    expect(setupEnvIdx).toBeLessThan(secureContextInRegisterIdx)
  })

  test('installProxyDispatcher runs after secureContext is registered', () => {
    const installIdx = serverSource.indexOf('installProxyDispatcher()')
    // Find the secureContext usage inside the register([...]) array,
    // not the import statement.
    const registerIdx = serverSource.indexOf('server.register([')
    const secureContextInRegisterIdx = serverSource.indexOf(
      'secureContext',
      registerIdx
    )

    expect(installIdx).toBeGreaterThan(-1)
    expect(secureContextInRegisterIdx).toBeGreaterThan(-1)
    expect(installIdx).toBeGreaterThan(secureContextInRegisterIdx)
  })
})
