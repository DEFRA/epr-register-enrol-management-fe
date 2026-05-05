import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

vi.mock('#/server/common/helpers/start-server.js', () => ({
  startServer: vi.fn().mockResolvedValue(undefined)
}))

describe('src/index.js', () => {
  it('registers unhandledRejection and uncaughtException listeners before starting the server', async () => {
    const beforeUnhandled = process.listenerCount('unhandledRejection')
    const beforeUncaught = process.listenerCount('uncaughtException')

    await import('./index.js')

    expect(process.listenerCount('unhandledRejection')).toBe(
      beforeUnhandled + 1
    )
    expect(process.listenerCount('uncaughtException')).toBe(beforeUncaught + 1)
  })
})
