// Kept in the session rather than the redirect's query string so the answer
// never appears in a URL.
const CONFIRMATION_SESSION_KEY = 'analyticsConsentConfirmation'
const CONFIRMATION_APP_KEY = 'analyticsConsentConfirmation'

export function setConsentConfirmation(request, choice) {
  request.yar?.set(CONFIRMATION_SESSION_KEY, choice)
}

export function popConsentConfirmation(request) {
  // Read before clearing: an unconditional clear marks the session modified
  // and would start a session for every signed-out visitor.
  const choice = request?.yar?.get(CONFIRMATION_SESSION_KEY)

  if (!choice) {
    return null
  }

  request.yar.clear(CONFIRMATION_SESSION_KEY)
  return choice
}

/**
 * onPreResponse, registered with `before: ['@hapi/yar']`. This can't be done
 * in the template context: vision renders views after yar has already saved
 * the session, so a clear made while rendering is lost and the message would
 * show on every page.
 *
 * Only a rendered page takes it, so answering from a URL that redirects
 * (e.g. `/`) keeps it for the page the redirect lands on.
 */
export function takeConsentConfirmationForView(request, h) {
  if (request.response?.variety === 'view') {
    request.app[CONFIRMATION_APP_KEY] = popConsentConfirmation(request)
  }
  return h.continue
}

export function consentConfirmationFor(request) {
  return request?.app?.[CONFIRMATION_APP_KEY] ?? null
}
