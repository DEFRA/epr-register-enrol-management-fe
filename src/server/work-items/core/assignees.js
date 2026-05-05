import { config } from '#/config/config.js'
import { STUB_USERS } from '#/server/routes/auth/stub/controller.js'

/**
 * Frozen copies of the stub directory entries. Frozen at module load so
 * callers that ignore the documented contract and try to mutate an entry
 * (e.g. `users[0].name = 'x'`) fail loudly in strict mode instead of
 * silently corrupting shared state.
 */
const FROZEN_STUB_USERS = Object.freeze(
  STUB_USERS.map((u) =>
    Object.freeze({ ...u, roles: Object.freeze([...u.roles]) })
  )
)

/**
 * Returns true when the stub auth provider is the configured directory
 * source. Real deployments will source assignable users from the identity
 * provider instead and `getAssignableUsers()` will return an empty list
 * until that wiring lands. Failing closed prevents the PoC stub directory
 * from leaking into any environment that uses real OAuth.
 */
function stubDirectoryEnabled() {
  return config.get('auth.stubEnabled') === true
}

/**
 * Directory of users a work item can be assigned to.
 *
 * For the PoC we reuse the stub login user list so the assign UI has
 * something concrete to show and the IDs align with the user that signs
 * in via the stub login. In environments where stub auth is disabled the
 * directory is intentionally empty — real deployments will source this
 * from the identity provider (group membership in Entra ID, a separate
 * users table, etc).
 *
 * Returns objects shaped `{ id, name, email, roles }` — the same envelope
 * the auth plugin puts on `request.auth.credentials`, so the caller can
 * use `id` for the assignment write and `name` for the display snapshot.
 *
 * Each call returns a fresh array of frozen entries so callers can sort
 * or filter the result without affecting other callers.
 */
export function getAssignableUsers() {
  if (!stubDirectoryEnabled()) return []
  return FROZEN_STUB_USERS.slice()
}

/** Look up a single assignable user by id, or `null` if not in the directory. */
export function findAssignableUser(id) {
  if (typeof id !== 'string' || id.trim() === '') return null
  if (!stubDirectoryEnabled()) return null
  return FROZEN_STUB_USERS.find((u) => u.id === id) ?? null
}
