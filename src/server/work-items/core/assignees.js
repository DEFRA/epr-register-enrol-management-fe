import { config } from '#/config/config.js'
import { STUB_USERS } from '#/server/routes/auth/stub/controller.js'
import { isEntraIdConfigured } from '#/server/common/helpers/auth/providers/azure-entra-id.js'
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
 * Returns true when the stub auth provider is enabled, so its fixed users
 * belong in the directory. Real deployments source assignable users from
 * the RA-446 assignable-users-store instead (populated incrementally at
 * login — see auth/controller.js), keeping the PoC stub directory from
 * ever leaking into an environment that uses real OAuth only.
 */
function stubDirectoryEnabled() {
  return config.get('auth.stubEnabled') === true
}

/**
 * RA-537: true when Entra ID sign-in is available, so the RA-446 store —
 * kept in sync by the Entra ID callback — belongs in the directory. With
 * stub auth on as well (hybrid mode: dev, and test/perf-test against the
 * Entra ID stub) both sources are listed; with stub auth on and no Entra
 * configuration (local) the store is never read.
 */
function storeDirectoryEnabled() {
  return !stubDirectoryEnabled() || isEntraIdConfigured(config)
}

async function readStore(read, fallback, message) {
  try {
    return await read()
  } catch (err) {
    logger.warn({ err }, message)
    return fallback
  }
}

/**
 * Directory of users a work item can be assigned to.
 *
 * In stub-auth environments this includes the stub login user list so the
 * assign UI has something concrete to show and the IDs align with the user
 * that signs in via the stub login. Wherever Entra ID sign-in is available
 * it also includes the RA-446 store, which is populated/pruned as
 * regulator-role users log in (see auth/controller.js and
 * assignable-users-store.js). Stub users come first; a store entry with a
 * stub user's id is dropped rather than listed twice.
 *
 * Returns objects shaped `{ id, name, email, roles }` — the same envelope
 * the auth plugin puts on `request.auth.credentials`, so the caller can
 * use `id` for the assignment write and `name` for the display snapshot.
 *
 * Each call returns a fresh array so callers can sort or filter the result
 * without affecting other callers.
 *
 * A Redis outage degrades to the stub users alone, or an empty directory
 * when stub auth is off (logged), rather than failing the caller — this is
 * read on every work-items list render, and a directory read must not be
 * able to 500 the whole list page.
 */
export async function getAssignableUsers() {
  const readDirectory = () =>
    readStore(listAssignableUsers, [], 'assignable-users directory read failed')

  if (!stubDirectoryEnabled()) {
    return readDirectory()
  }
  const stubUsers = FROZEN_STUB_USERS.slice()
  if (!storeDirectoryEnabled()) {
    return stubUsers
  }
  const stubIds = new Set(stubUsers.map((u) => u.id))
  const storeUsers = await readDirectory()
  return [...stubUsers, ...storeUsers.filter((u) => !stubIds.has(u.id))]
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
    const stubUser = FROZEN_STUB_USERS.find((u) => u.id === id)
    if (stubUser) {
      return stubUser
    }
  }
  if (!storeDirectoryEnabled()) {
    return null
  }
  return readStore(
    () => findAssignableUserInStore(id),
    null,
    'assignable-user directory lookup failed'
  )
}
