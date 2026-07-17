/**
 * Redirects the site root to the work items list (RA-326). There is no
 * standalone home page any more; '/' exists only so old bookmarks/links
 * land somewhere useful instead of 404ing. Default auth applies, so an
 * unauthenticated visitor still hits the login flow before the redirect.
 */
export const root = {
  plugin: {
    name: 'root',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/',
          handler(_request, h) {
            return h.redirect('/work-items')
          }
        }
      ])
    }
  }
}
