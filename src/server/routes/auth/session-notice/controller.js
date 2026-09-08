import { dismissNotice } from '#/server/common/helpers/auth/concurrent-login.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

// Only follow the Referer back if it is same-host — a full URL is expected
// (browsers send an absolute Referer), and anything else falls back to the
// work items list so this can never be turned into an open redirect.
function returnTo(request, fallback) {
  const ref = request.info.referrer
  if (ref) {
    try {
      const url = new URL(ref)
      if (url.host === request.info.host) {
        return `${url.pathname}${url.search}`
      }
    } catch {
      // Referer wasn't a valid absolute URL — ignore it.
    }
  }
  return fallback
}

// RA-462: dismiss the concurrent-login notice. The progressive-enhancement
// toast POSTs here with `Accept: application/json` and expects 204; the no-JS
// "Hide" form posts a normal request and expects a redirect back to the page.
export async function dismissSessionNoticeController(request, h) {
  await dismissNotice(request)

  const wantsJson = (request.headers.accept ?? '').includes('application/json')
  if (wantsJson) {
    return h.response().code(statusCodes.noContent)
  }

  return h.redirect(returnTo(request, '/work-items'))
}
