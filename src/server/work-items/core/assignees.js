import { STUB_USERS } from '#/server/routes/auth/stub/controller.js'

/**
 * Directory of users a work item can be assigned to.
 *
 * Real deployments will source this from the identity provider (group
 * membership in Entra ID, a separate users table, etc). For the PoC we reuse
 * the stub login user list so the assign UI has something concrete to show
 * and the IDs align with the user that signs in via the stub login.
 *
 * Returns objects shaped `{ id, name, email, roles }` — the same envelope
 * the auth plugin puts on `request.auth.credentials`, so the caller can use
 * `id` for the assignment write and `name` for the display snapshot.
 */
export function getAssignableUsers() {
  return STUB_USERS
}

/** Look up a single assignable user by id, or `null` if not in the directory. */
export function findAssignableUser(id) {
  if (typeof id !== 'string' || id.trim() === '') return null
  return STUB_USERS.find((u) => u.id === id) ?? null
}
