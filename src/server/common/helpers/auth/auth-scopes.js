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

export const ALL_ROLES = [ROLE_STANDARD, ROLE_ASSIGN]

export const requireStandard = { auth: { scope: [ROLE_STANDARD] } }

export const requireAssign = { auth: { scope: [ROLE_ASSIGN] } }
