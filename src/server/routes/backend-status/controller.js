import { config } from '#/config/config.js'
import { getBackendHealth } from '#/server/common/helpers/backend-api/backend-api.js'

const PAGE_TITLE = 'Backend status'

/**
 * Renders a page showing whether the case management backend is reachable.
 * Used as an end-to-end smoke test of the frontend → backend integration.
 */
export const backendStatusController = {
  async handler(_request, h) {
    const result = await getBackendHealth()

    return h.view('backend-status/index', {
      pageTitle: PAGE_TITLE,
      heading: PAGE_TITLE,
      breadcrumbs: [{ text: 'Home', href: '/' }, { text: PAGE_TITLE }],
      backendUrl: config.get('backendApi.url'),
      result
    })
  }
}
