import { config } from '#/config/config.js'

// RA-462: concurrent logins stay valid, but every session for an identity is
// told when a new one is established — the session that was already active
// gets an "alert", the one that just signed in gets an "info" note. Nothing
// here invalidates a session.
//
// State lives in three places:
//  - yar session keys (below), stamped at login / dismissal
//  - a per-identity registry (a catbox segment on the shared session cache),
//    holding only the most recent login for that userId
//  - request.app.concurrentLoginNotice, computed per request by the onPostAuth
//    extension and surfaced to templates by the nunjucks context

export const LOGIN_AT_KEY = 'loginAt'
export const INFO_KEY = 'concurrentLoginInfo'
export const NOTICE_DISMISSED_KEY = 'concurrentLoginNoticeDismissedFor'

const REGISTRY_SEGMENT = 'concurrent-login'

function logWarn(request, msg, err) {
  request.logger?.warn?.({ err }, msg)
}

function getRegistry(request) {
  return request.server?.app?.activeSessionRegistry ?? null
}

/**
 * Record this session as the latest login for `userId` and return whatever
 * was recorded before (or null). Best-effort: a cache failure is logged and
 * swallowed so it can never affect the login outcome.
 */
export async function recordLogin(request, userId) {
  const registry = getRegistry(request)
  if (!registry || !userId) {
    return null
  }

  let previous = null
  try {
    previous = (await registry.get(userId)) ?? null
  } catch (err) {
    logWarn(request, 'concurrent-login: registry read on login failed', err)
  }

  try {
    await registry.set(userId, {
      lastLoginAt: Date.now(),
      lastLoginSessionId: request.yar.id
    })
  } catch (err) {
    logWarn(request, 'concurrent-login: registry write on login failed', err)
  }

  return previous
}

/**
 * Stamp the freshly-established session and, if another session already
 * existed for this identity, arm the "info" note on this new session.
 * Call immediately after request.yar.reset() + yar.set('user', ...).
 */
export async function markLoginAndNotifyPrevious(request, userId) {
  request.yar.set(LOGIN_AT_KEY, Date.now())
  const previous = await recordLogin(request, userId)
  if (previous && previous.lastLoginSessionId !== request.yar.id) {
    request.yar.set(INFO_KEY, { otherLoginAt: previous.lastLoginAt })
  }
}

/** Drop the registry entry for `userId` on logout. Best-effort. */
export async function clearLogin(request, userId) {
  const registry = getRegistry(request)
  if (!registry || !userId) {
    return
  }
  try {
    await registry.drop(userId)
  } catch (err) {
    logWarn(request, 'concurrent-login: registry drop on logout failed', err)
  }
}

function formatLoginTime(ms) {
  const d = new Date(ms)
  const time = d
    .toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    .replace(/\s?([ap])m$/i, '$1m')
  const date = d.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
  return `${time} on ${date}`
}

export function buildNotice(variant, otherLoginAt) {
  return { variant, otherLoginAt, at: formatLoginTime(otherLoginAt) }
}

// This session logged in while another one already existed for the identity
// — the one-shot flag armed by markLoginAndNotifyPrevious.
function computeInfoNotice(request, dismissedFor) {
  const info = request.yar.get(INFO_KEY)
  if (info?.otherLoginAt && info.otherLoginAt > dismissedFor) {
    return buildNotice('info', info.otherLoginAt)
  }
  return null
}

// A newer login exists elsewhere for this identity. null on any registry
// error or absence — the caller treats that as "no notice" (fail-open).
async function computeAlertNotice(request, userId, dismissedFor) {
  const registry = getRegistry(request)
  if (!registry) {
    return null
  }

  let latest
  try {
    latest = await registry.get(userId)
  } catch (err) {
    logWarn(request, 'concurrent-login: registry read on request failed', err)
    return null
  }

  const sessionLoginAt = request.yar.get(LOGIN_AT_KEY) ?? 0
  const isNewerElsewhere =
    latest &&
    latest.lastLoginSessionId !== request.yar.id &&
    latest.lastLoginAt > sessionLoginAt &&
    latest.lastLoginAt > dismissedFor

  return isNewerElsewhere ? buildNotice('alert', latest.lastLoginAt) : null
}

/**
 * onPostAuth: decide whether this request's response should carry a notice,
 * and of which kind. Runs for every request; a no-op unless authenticated and
 * the feature flag is on. Fail-open: a registry error means no notice.
 */
export async function concurrentLoginNoticeExt(request, h) {
  if (!config.get('session.concurrentLoginNotice.enabled')) {
    return h.continue
  }
  if (!request.auth?.isAuthenticated) {
    return h.continue
  }

  const userId = request.auth.credentials?.id
  if (!userId) {
    return h.continue
  }

  const dismissedFor = request.yar.get(NOTICE_DISMISSED_KEY) ?? 0

  const notice =
    computeInfoNotice(request, dismissedFor) ??
    (await computeAlertNotice(request, userId, dismissedFor))

  if (notice) {
    request.app.concurrentLoginNotice = notice
  }

  return h.continue
}

/**
 * Records the dismissal against the newest login this identity knows about,
 * so the notice stays gone until a *still-newer* sign-in. Also clears the
 * one-shot info flag.
 */
export async function dismissNotice(request) {
  const userId = request.auth.credentials?.id
  const registry = getRegistry(request)

  let latestAt = Date.now()
  if (registry && userId) {
    try {
      const latest = await registry.get(userId)
      if (latest?.lastLoginAt) {
        latestAt = latest.lastLoginAt
      }
    } catch (err) {
      logWarn(request, 'concurrent-login: registry read on dismiss failed', err)
    }
  }

  const existing = request.yar.get(NOTICE_DISMISSED_KEY) ?? 0
  request.yar.set(NOTICE_DISMISSED_KEY, Math.max(existing, latestAt))
  request.yar.clear(INFO_KEY)
}

export const concurrentLoginPlugin = {
  plugin: {
    name: 'concurrent-login',
    register(server) {
      server.app.activeSessionRegistry = server.cache({
        cache: config.get('session.cache.name'),
        segment: REGISTRY_SEGMENT,
        expiresIn: config.get('session.cache.ttl')
      })
      server.ext('onPostAuth', concurrentLoginNoticeExt)
    }
  }
}
