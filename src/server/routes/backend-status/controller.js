import { config } from '#/config/config.js'
import { getBackendHealth } from '#/server/common/helpers/backend-api/backend-api.js'

/**
 * Renders a page showing whether the case management backend is reachable.
 * Used as an end-to-end smoke test of the frontend → backend integration.
 */
export const backendStatusController = {
  async handler(_request, h) {
    const result = await getBackendHealth()

    return h.view('backend-status/index', {
      pageTitle: 'Backend status',
      heading: 'Backend status',
      breadcrumbs: [{ text: 'Home', href: '/' }, { text: 'Backend status' }],
      backendUrl: config.get('backendApi.url'),
      result
    })
  }
}
