import { vi } from 'vitest'

import { Cluster, Redis } from 'ioredis'

import { config } from '../../../config/config.js'
import { buildRedisClient } from './redis-client.js'

vi.mock('ioredis', () => ({
  ...vi.importActual('ioredis'),
  Cluster: vi.fn(function () {
    return { on: () => ({}) }
  }),
  Redis: vi.fn(function () {
    return { on: () => ({}) }
  })
}))

describe('#buildRedisClient', () => {
  beforeEach(() => {
    Redis.mockClear()
    Cluster.mockClear()
  })

  describe('When Redis Single InstanceCache is requested', () => {
    beforeEach(() => {
      buildRedisClient(config.get('redis'))
    })

    test('Should instantiate a single Redis client', () => {
      expect(Redis).toHaveBeenCalledWith({
        db: 0,
        host: '127.0.0.1',
        keyPrefix: 'epr-register-case-management:',
        port: 6379
      })
    })

    test('Should not pass a tls option when useTLS is false', () => {
      const args = Redis.mock.calls[0][0]
      expect(args.tls).toBeUndefined()
    })
  })

  describe('When a Redis single instance is requested with TLS', () => {
    beforeEach(() => {
      buildRedisClient({
        ...config.get('redis'),
        useTLS: true
      })
    })

    test('Should pass tls with rejectUnauthorized: true', () => {
      const args = Redis.mock.calls[0][0]
      expect(args.tls).toEqual({ rejectUnauthorized: true })
    })
  })

  describe('When a Redis Cluster is requested', () => {
    beforeEach(() => {
      buildRedisClient({
        ...config.get('redis'),
        useSingleInstanceCache: false,
        useTLS: true,
        username: 'user',
        password: 'pass'
      })
    })

    test('Should instantiate a Redis Cluster client', () => {
      expect(Cluster).toHaveBeenCalledWith(
        [{ host: '127.0.0.1', port: 6379 }],
        {
          dnsLookup: expect.any(Function),
          keyPrefix: 'epr-register-case-management:',
          redisOptions: {
            db: 0,
            password: 'pass',
            tls: { rejectUnauthorized: true },
            username: 'user'
          },
          slotsRefreshTimeout: 10000
        }
      )
    })
  })

  describe('When a Redis Cluster is requested without TLS', () => {
    beforeEach(() => {
      buildRedisClient({
        ...config.get('redis'),
        useSingleInstanceCache: false,
        useTLS: false,
        username: 'user',
        password: 'pass'
      })
    })

    test('Should not pass a tls option in redisOptions', () => {
      const args = Cluster.mock.calls[0][1]
      expect(args.redisOptions.tls).toBeUndefined()
    })
  })
})
