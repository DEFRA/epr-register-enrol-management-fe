import { config } from '#/config/config.js'

const PAGE_TITLE = 'Cookies'
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

export function describeDuration(ms) {
  if (ms % HOUR_MS === 0) {
    const hours = ms / HOUR_MS
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  const minutes = Math.round(ms / MINUTE_MS)
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

export const cookiesController = {
  handler(_request, h) {
    return h.view('cookies/index', {
      pageTitle: PAGE_TITLE,
      heading: PAGE_TITLE,
      // The page has its own form for this choice.
      hideCookieBanner: true,
      sessionCookie: {
        name: config.get('session.cache.name'),
        expires: describeDuration(config.get('session.cookie.ttl'))
      }
    })
  }
}
