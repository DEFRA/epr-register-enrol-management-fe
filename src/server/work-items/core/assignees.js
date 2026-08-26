import { config } from '#/config/config.js'
import { STUB_USERS } from '#/server/routes/auth/stub/controller.js'
import {
  findAssignableUserInStore,
  listAssignableUsers
} from '#/server/common/helpers/auth/assignable-users-store.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

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
 * source. Real deployments source assignable users from the RA-446
 * assignable-users-store instead (populated incrementally at login — see
 * auth/controller.js), keeping the PoC stub directory from ever leaking
 * into an environment that uses real OAuth.
 */
function stubDirectoryEnabled() {
  return config.get('auth.stubEnabled') === true
}

/**
 * Directory of users a work item can be assigned to.
 *
 * In stub-auth environments this reuses the stub login user list so the
 * assign UI has something concrete to show and the IDs align with the user
 * that signs in via the stub login. In real (Entra ID) environments it
 * reads the RA-446 store instead, which is populated/pruned as regulator
 * -role users log in (see auth/controller.js and assignable-users-store.js).
 *
 * Returns objects shaped `{ id, name, email, roles }` — the same envelope
 * the auth plugin puts on `request.auth.credentials`, so the caller can
 * use `id` for the assignment write and `name` for the display snapshot.
 *
 * Each call returns a fresh array so callers can sort or filter the result
 * without affecting other callers.
 *
 * A Redis outage degrades to an empty directory (logged) rather than
 * failing the caller — this is read on every work-items list render, and
 * before RA-446 it was a pure in-memory function that could never fail;
 * a directory read must not be able to 500 the whole list page.
 */
export async function getAssignableUsers() {
  if (stubDirectoryEnabled()) {
    return FROZEN_STUB_USERS.slice()
  }
  try {
    return await listAssignableUsers()
  } catch (err) {
    logger.warn({ err }, 'assignable-users directory read failed')
    return []
  }
}

/**
 * Look up a single assignable user by id, or `null` if not in the
 * directory (including on a Redis failure — callers already treat `null`
 * as "not found" and fall back accordingly, e.g. the assign write path
 * falls back to the submitted `assigneeName`).
 */
export async function findAssignableUser(id) {
  if (typeof id !== 'string' || id.trim() === '') {
    return null
  }
  if (stubDirectoryEnabled()) {
    return FROZEN_STUB_USERS.find((u) => u.id === id) ?? null
  }
  try {
    return await findAssignableUserInStore(id)
  } catch (err) {
    logger.warn({ err }, 'assignable-user directory lookup failed')
    return null
  }
}
