import { Engine as CatboxRedis } from '@hapi/catbox-redis'
import { Engine as CatboxMemory } from '@hapi/catbox-memory'

import { createLogger } from '../logging/logger.js'
import { buildRedisClient } from '../redis-client.js'
import { config } from '#/config/config.js'

export function getCacheEngine(engine) {
  const logger = createLogger()

  if (engine === 'redis') {
    logger.info('Using Redis session cache')
    const redisClient = buildRedisClient(config.get('redis'))
    return new CatboxRedis({ client: redisClient })
  }

  if (config.get('isProduction')) {
    throw new Error(
      'Invalid session cache engine in production: SESSION_CACHE_ENGINE must be set to "redis". Catbox Memory is for local development only.'
    )
  }

  logger.info('Using Catbox Memory session cache')
  return new CatboxMemory()
}
