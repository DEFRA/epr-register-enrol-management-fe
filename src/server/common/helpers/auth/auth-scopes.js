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
