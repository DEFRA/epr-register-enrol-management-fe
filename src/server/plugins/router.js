import inert from '@hapi/inert'

import { home } from '../routes/home/index.js'
import { about } from '../routes/about/index.js'
import { backendStatus } from '../routes/backend-status/index.js'
import { health } from '../routes/health/index.js'
import { workItems } from '../routes/work-items/index.js'
import { serveStaticFiles } from './serve-static-files.js'
import { workItemsPlugin } from '../work-items/core/plugin.js'
import { workItemModules } from '../work-items/modules.js'
import { config } from '#/config/config.js'

export const router = {
  plugin: {
    name: 'router',
    async register(server) {
      await server.register([inert])

      // Health-check route. Used by platform to check if service is running, do not remove!
      await server.register([health])

      // Application specific routes, add your own routes here
      await server.register([home, about, backendStatus, workItems])

      // Work item modules — see src/server/work-items/modules.js
      await server.register(workItemsPlugin(workItemModules))

      // Static assets
      if (!config.get('isProduction') && !config.get('isTest')) {
        await (async () => {
          const createViteServer = (await import('vite')).createServer
          const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'custom'
          })

          const { finished } = await import('node:stream/promises')
          const connectMod = (await import('connect')).default

          const app = connectMod()
          app.use('/public', vite.middlewares)

          server.route({
            method: '*',
            path: '/public/{param*}',
            options: { auth: false },
            handler: async (request, h) => {
              const { req, res } = request.raw
              const { promise: next, resolve: resolveNext } =
                Promise.withResolvers()
              app(req, res, () => resolveNext(true))
              const nextCalled = await Promise.race([finished(res), next])
              if (nextCalled) {
                return h.response().code(404)
              }
              return h.abandon
            }
          })
        })()
      } else {
        server.register(serveStaticFiles)
      }
    }
  }
}
