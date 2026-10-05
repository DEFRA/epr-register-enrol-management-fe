import { createServer } from '../../server.js'
import { config } from '../../../config/config.js'
import { logAnalyticsMisconfiguration } from '../analytics/enabled.js'

async function startServer() {
  const server = await createServer()
  await server.start()

  server.logger.info('Server started successfully')
  server.logger.info(
    `Access your frontend on http://localhost:${config.get('port')}`
  )
  logAnalyticsMisconfiguration(server.logger)

  return server
}

export { startServer }
