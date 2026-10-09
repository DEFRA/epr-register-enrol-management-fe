import { vi } from 'vitest'

import hapi from '@hapi/hapi'
import { statusCodes } from '../constants/status-codes.js'

describe('#startServer', () => {
  let createServerSpy
  let hapiServerSpy
  let startServerImport
  let createServerImport
  let config

  beforeAll(async () => {
    vi.stubEnv('PORT', '3097')

    // Imported after PORT is stubbed: config reads it on first import.
    ;({ config } = await import('#/config/config.js'))
    createServerImport = await import('../../server.js')
    startServerImport = await import('./start-server.js')

    createServerSpy = vi.spyOn(createServerImport, 'createServer')
    hapiServerSpy = vi.spyOn(hapi, 'server')
  }, 30000)

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  describe('When server starts', () => {
    let server

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test('Should start up server as expected', async () => {
      server = await startServerImport.startServer()

      expect(createServerSpy).toHaveBeenCalled()
      expect(hapiServerSpy).toHaveBeenCalled()

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/health'
      })

      expect(result).toEqual({ message: 'success' })
      expect(statusCode).toBe(statusCodes.ok)
    })
  })

  describe('When analytics is switched on without a container id', () => {
    let server
    let original

    beforeAll(() => {
      original = {
        isEnabled: config.get('analytics.isEnabled'),
        gtmContainerId: config.get('analytics.gtmContainerId')
      }
      config.set('analytics.isEnabled', true)
      config.set('analytics.gtmContainerId', '')
    })

    afterAll(async () => {
      config.set('analytics.isEnabled', original.isEnabled)
      config.set('analytics.gtmContainerId', original.gtmContainerId)
      await server?.stop({ timeout: 0 })
    })

    test('logs the misconfiguration and still starts', async () => {
      const enabledImport = await import('../analytics/enabled.js')
      const logSpy = vi.spyOn(enabledImport, 'logAnalyticsMisconfiguration')

      server = await startServerImport.startServer()

      expect(logSpy).toHaveBeenCalledWith(server.logger)
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/health'
      })
      expect(statusCode).toBe(statusCodes.ok)
    })
  })

  describe('When server start fails', () => {
    test('Should log failed startup message', async () => {
      createServerSpy.mockRejectedValue(new Error('Server failed to start'))

      await expect(startServerImport.startServer()).rejects.toThrow(
        'Server failed to start'
      )
    })
  })
})
