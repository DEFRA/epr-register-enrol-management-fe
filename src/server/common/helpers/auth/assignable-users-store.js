import { config } from '#/config/config.js'
import { buildRedisClient } from '#/server/common/helpers/redis-client.js'
import { ROLE_STANDARD } from '#/server/common/helpers/auth/auth-scopes.js'

/**
 * RA-446. Real-Entra-ID replacement for the stub assignable-user directory.
 *
 * There's no Graph API access (no app-only credentials/admin consent) to
 * enumerate app-role group membership directly, so the directory is built
 * incrementally instead: every login already re-checks the caller's `roles`
 * claim for the regulator app role (see auth/controller.js), so that same
 * check is reused to upsert/remove the caller's entry here rather than
 * standing up a second source of truth.
 *
 * Stored as a single Redis hash (one entry per user field, one key overall)
 * rather than one key per user. That's not just simpler — production runs
 * Redis Cluster (`redis.useSingleInstanceCache` defaults to `!isProduction`,
 * see config.js), where a per-user key design breaks two ways: `KEYS`
 * without a computable slot gets routed to one arbitrary node rather than
 * fanning out, and a multi-key `MGET` across keys that hash to different
 * slots is rejected outright (CROSSSLOT). A single hash key always resolves
 * to exactly one slot, so `HGETALL` reliably returns the whole directory
 * regardless of cluster topology.
 *
 * Staleness is handled two ways, since neither alone is sufficient:
 *  - an entry is deleted outright the moment a login shows the role gone
 *    (catches an active user whose role was revoked)
 *  - every read prunes (and skips returning) any entry whose `lastLoginAt`
 *    is older than the configured inactivity window, so a user who stops
 *    logging in (role pulled while away, or simply left) ages out on their
 *    own without a separate scheduled pruning job. This is computed live
 *    against the current config on every read rather than baked in via a
 *    per-key TTL at write time, so lowering the threshold takes effect on
 *    the very next read instead of only for entries written afterwards.
 * The gap this leaves — a user loses the role and logs back in before the
 * inactivity window lapses but after the role was pulled — is covered by
 * the delete-on-login-without-role path above, not by expiry.
 */

const HASH_KEY = 'assignable-users'

let sharedClient

function getClient() {
  if (!sharedClient) {
    sharedClient = buildRedisClient(config.get('redis'))
  }
  return sharedClient
}

function inactivityThresholdMs() {
  return config.get('auth.assignableUserInactivityDays') * 24 * 60 * 60 * 1000
}

function isExpired(entry) {
  const lastLoginMs = Date.parse(entry.lastLoginAt)
  return (
    Number.isNaN(lastLoginMs) ||
    Date.now() - lastLoginMs > inactivityThresholdMs()
  )
}

/** Best-effort prune — a failed cleanup must not fail the read it ran from. */
function pruneInBackground(ids) {
  if (ids.length === 0) {
    return
  }
  getClient()
    .hdel(HASH_KEY, ...ids)
    .catch(() => {})
}

/** Upsert the caller as assignable, refreshing their inactivity window. */
export async function upsertAssignableUser({ id, name, email, roles }) {
  const entry = {
    id,
    name: name ?? null,
    email: email ?? null,
    roles: roles ?? [ROLE_STANDARD],
    lastLoginAt: new Date().toISOString()
  }
  await getClient().hset(HASH_KEY, id, JSON.stringify(entry))
}

/** Remove a user from the assignable directory (role revoked, or pruned). */
export async function removeAssignableUser(id) {
  await getClient().hdel(HASH_KEY, id)
}

/**
 * All current, non-expired directory entries, sorted by name (id when no
 * name is set) so the assign `<select>` and officer filter render in a
 * stable order rather than whatever arbitrary order the hash yields.
 */
export async function listAssignableUsers() {
  const raw = await getClient().hgetall(HASH_KEY)
  const expiredIds = []
  const users = []
  for (const [id, json] of Object.entries(raw)) {
    const entry = JSON.parse(json)
    if (isExpired(entry)) {
      expiredIds.push(id)
      continue
    }
    users.push(entry)
  }
  pruneInBackground(expiredIds)
  return users.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
}

/** A single directory entry by id, or `null` if not present/expired. */
export async function findAssignableUserInStore(id) {
  const raw = await getClient().hget(HASH_KEY, id)
  if (!raw) {
    return null
  }
  const entry = JSON.parse(raw)
  if (isExpired(entry)) {
    pruneInBackground([id])
    return null
  }
  return entry
}
