/**
 * Route auth option helpers for enforcing regulator role at the framework level.
 *
 * Two roles are recognised in the case management system:
 *   - 'standard' — view and progress work items
 *   - 'assign'   — additionally able to assign work items to other users
 *
 * Hapi checks the scope before the controller runs, so users without the
 * required role receive a 403 without entering any handler code.
 *
 * Usage in a route definition:
 *
 *   import { requireAssign } from '../common/helpers/auth/auth-scopes.js'
 *
 *   server.route({
 *     method: 'POST',
 *     path: '/work-items/{id}/assign',
 *     options: requireAssign,
 *     handler: assignController
 *   })
 */

export const ROLE_STANDARD = 'standard'
export const ROLE_ASSIGN = 'assign'
export const ROLE_DECISION_MAKER = 'reaccreditation-decision-maker'
export const ROLE_TEAM_LEADER = 'team-leader'

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

export const ALL_ROLES = [ROLE_STANDARD, ROLE_ASSIGN]

export const requireStandard = { auth: { scope: [ROLE_STANDARD] } }

export const requireAssign = { auth: { scope: [ROLE_ASSIGN] } }

export const requireTeamLeader = { auth: { scope: [ROLE_TEAM_LEADER] } }
