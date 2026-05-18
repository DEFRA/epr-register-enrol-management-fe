import { vi } from 'vitest'

import { Engine as CatboxRedis } from '@hapi/catbox-redis'
import { Engine as CatboxMemory } from '@hapi/catbox-memory'

import { getCacheEngine } from './cache-engine.js'
import { config } from '../../../../config/config.js'

const mockLoggerInfo = vi.fn()

vi.mock('ioredis', () => ({
  ...vi.importActual('ioredis'),
  Cluster: vi.fn(function () {
    return { on: () => ({}) }
  }),
  Redis: vi.fn(function () {
    return { on: () => ({}) }
  })
}))
vi.mock('@hapi/catbox-redis')
vi.mock('@hapi/catbox-memory')
vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({
    info: (...args) => mockLoggerInfo(...args),
    error: vi.fn()
  })
}))

describe('#getCacheEngine', () => {
  describe('When Redis cache engine has been requested', () => {
    beforeEach(() => {
      getCacheEngine('redis')
    })

    test('Should setup Redis cache', () => {
      expect(CatboxRedis).toHaveBeenCalledWith(expect.any(Object))
    })

    test('Should log expected Redis message', () => {
      expect(mockLoggerInfo).toHaveBeenCalledWith('Using Redis session cache')
    })
  })

  describe('When In memory cache engine has been requested', () => {
    beforeEach(() => {
      getCacheEngine()
    })

    test('Should setup In memory cache', () => {
      expect(CatboxMemory).toHaveBeenCalledTimes(1)
    })

    test('Should log expected CatBox memory message', () => {
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Using Catbox Memory session cache'
      )
    })
  })

  describe('When In memory cache engine has been requested in a deployed env', () => {
    beforeEach(() => {
      config.set('isDeployed', true)
    })

    afterEach(() => {
      config.set('isDeployed', false)
    })

    test('Should throw an error naming the env var and required value', () => {
      expect(() => getCacheEngine()).toThrow(/SESSION_CACHE_ENGINE.*redis/)
    })

    test('Should not construct a Catbox Memory engine', () => {
      expect(() => getCacheEngine()).toThrow()
      expect(CatboxMemory).not.toHaveBeenCalled()
    })

    test('Should still construct Redis engine when configured', () => {
      getCacheEngine('redis')
      expect(CatboxRedis).toHaveBeenCalledWith(expect.any(Object))
    })
  })
})
