/**
 * Route auth option helpers for enforcing regulator role at the framework level.
 *
 * RA-323: every caseworker holds the same role — there is no permission
 * tiering within the case management system. 'standard' just means
 * "authenticated caseworker".
 *
 * Hapi checks the scope before the controller runs, so an unauthenticated
 * caller receives a 403 without entering any handler code.
 *
 * Usage in a route definition:
 *
 *   import { requireStandard } from '../common/helpers/auth/auth-scopes.js'
 *
 *   server.route({
 *     method: 'POST',
 *     path: '/work-items/{id}/assign',
 *     options: requireStandard,
 *     handler: assignController
 *   })
 */

export const ROLE_STANDARD = 'standard'

/**
 * RA-335: support users get a read-only view of the same case data as a
 * caseworker, identified by a separate Entra ID app role
 * (`Waste.SupportUser.ReadOnly`, see config `auth.azureEntraId.supportUserRoleValue`).
 * They are NOT a permission tier on top of `ROLE_STANDARD` — a session has
 * exactly one of the two roles, never both — so routes that mutate data
 * must keep requiring `ROLE_STANDARD` specifically (via `requireStandard`)
 * rather than "any authenticated user", or a support user's session would
 * pass the scope check.
 */
export const ROLE_SUPPORT_READONLY = 'support-readonly'

/**
 * Nation-scoped roles. A user with exactly one of these roles is
 * automatically defaulted to that nation's filter on the worklist (RA-125).
 */
export const ROLE_NATION_ENGLAND = 'role:nation-england'
export const ROLE_NATION_SCOTLAND = 'role:nation-scotland'
export const ROLE_NATION_WALES = 'role:nation-wales'
export const ROLE_NATION_NORTHERN_IRELAND = 'role:nation-northern-ireland'

/** Map from role string to the nation value used in backend query params. */
export const NATION_ROLE_MAP = {
  [ROLE_NATION_ENGLAND]: 'England',
  [ROLE_NATION_SCOTLAND]: 'Scotland',
  [ROLE_NATION_WALES]: 'Wales',
  [ROLE_NATION_NORTHERN_IRELAND]: 'NorthernIreland'
}

export const requireStandard = { auth: { scope: [ROLE_STANDARD] } }
export const requireSupportReadonly = {
  auth: { scope: [ROLE_SUPPORT_READONLY] }
}
