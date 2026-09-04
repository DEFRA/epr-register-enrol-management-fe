import { dismissNotice } from '#/server/common/helpers/auth/concurrent-login.js'

// RA-462: dismiss the concurrent-login notice. The progressive-enhancement
// toast POSTs here with `Accept: application/json` and expects 204; the no-JS
// "Hide" form posts a normal request and expects a redirect back to the page.
export async function dismissSessionNoticeController(request, h) {
  await dismissNotice(request)

  const wantsJson = (request.headers.accept ?? '').includes('application/json')
  if (wantsJson) {
    return h.response().code(204)
  }

  const back = request.info.referrer || '/work-items'
  return h.redirect(back)
}
