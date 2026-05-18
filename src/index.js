import process from 'node:process'

import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { startServer } from '#/server/common/helpers/start-server.js'

process.on('unhandledRejection', (error) => {
  const logger = createLogger()
  logger.error({ err: error }, 'Unhandled rejection')
  process.exitCode = 1
})

process.on('uncaughtException', (error) => {
  const logger = createLogger()
  logger.error({ err: error }, 'Uncaught exception')
  process.exitCode = 1
})

await startServer()
