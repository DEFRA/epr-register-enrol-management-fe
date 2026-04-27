import {
  stubLoginGetController,
  stubLoginPostController
} from './controller.js'

export const stubAuthRoutes = {
  plugin: {
    name: 'stub-auth-routes',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/auth/stub/login',
          options: { auth: false },
          handler: stubLoginGetController
        },
        {
          method: 'POST',
          path: '/auth/stub/login',
          options: { auth: false },
          handler: stubLoginPostController
        }
      ])
    }
  }
}
