import path from 'node:path'
import { readFileSync } from 'node:fs'

import { config } from '#/config/config.js'
import { buildNavigation } from './build-navigation.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { ROLE_SUPPORT_READONLY } from '#/server/common/helpers/auth/auth-scopes.js'

const logger = createLogger()
const assetPath = config.get('assetPath')
const manifestPath = path.join(
  config.get('root'),
  '.public/.vite/manifest.json'
)

let viteManifest

export function context(request) {
  if (config.get('isProduction') && !viteManifest) {
    try {
      viteManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (error) {
      logger.error(`Vite ${path.basename(manifestPath)} not found`)
    }
  }

  const credentials = request?.auth?.credentials ?? null
  // RA-335: single source of truth templates use to disable modifying
  // actions for a signed-in support user — see docs/authentication.md.
  const user = credentials
    ? {
        ...credentials,
        isReadOnly: (credentials.roles ?? []).includes(ROLE_SUPPORT_READONLY)
      }
    : null

  return {
    assetPath: `${assetPath}/assets`,
    serviceName: config.get('serviceName'),
    serviceUrl: null,
    breadcrumbs: [],
    navigation: buildNavigation(request),
    user,
    // RA-462: set by the concurrent-login onPostAuth extension when another
    // sign-in for this identity has been detected.
    concurrentLoginNotice: request?.app?.concurrentLoginNotice ?? null,
    getAssetPath(asset) {
      if (!config.get('isProduction')) {
        return `${assetPath}/${asset}`
      }

      const viteAssetPath = viteManifest?.[asset]?.file
      return `${assetPath}/${viteAssetPath ?? asset}`
    }
  }
}
