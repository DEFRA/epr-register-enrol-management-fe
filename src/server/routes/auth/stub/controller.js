import { config } from '#/config/config.js'
import {
  ROLE_TEAM_LEADER,
  ROLE_ASSIGN,
  ROLE_DECISION_MAKER,
  ROLE_NATION_ENGLAND,
  ROLE_NATION_NORTHERN_IRELAND,
  ROLE_NATION_SCOTLAND,
  ROLE_NATION_WALES,
  ROLE_STANDARD
} from '#/server/common/helpers/auth/auth-scopes.js'

/**
 * Static directory of stub assignable users. Exported for the assignee-
 * picker so the assign UI has real names to list. The login form builds a
 * user dynamically from the submitted role + nation choice, and the
 * resulting session id (`stub-<role>-1`) intentionally matches these ids
 * so the "My work items" filter works out of the box.
 */
export const STUB_USERS = [
  {
    id: 'stub-standard-1',
    name: 'Stub Standard User',
    email: 'standard@stub.example',
    roles: [ROLE_STANDARD]
  },
  {
    id: 'stub-assign-1',
    name: 'Stub Assign User',
    email: 'assign@stub.example',
    roles: [ROLE_STANDARD, ROLE_ASSIGN]
  },
  {
    id: 'stub-decision-maker-1',
    name: 'Stub Decision Maker',
    email: 'decision-maker@stub.example',
    roles: [ROLE_STANDARD, ROLE_DECISION_MAKER]
  }
]

const ROLE_OPTIONS = [
  {
    value: 'standard',
    label: 'Standard',
    roles: [ROLE_STANDARD]
  },
  {
    value: 'assign',
    label: 'Assign (can assign work items)',
    roles: [ROLE_STANDARD, ROLE_ASSIGN]
  },
  {
    value: 'decision-maker',
    label: 'Decision Maker',
    roles: [ROLE_STANDARD, ROLE_DECISION_MAKER]
  },
  {
    value: 'team-leader',
    label: 'Team Leader (can manage SLA)',
    roles: [ROLE_STANDARD, ROLE_TEAM_LEADER]
  }
]

const NATION_OPTIONS = [
  { value: '', label: 'None (see all nations)', role: null },
  { value: 'England', label: 'England', role: ROLE_NATION_ENGLAND },
  { value: 'Scotland', label: 'Scotland', role: ROLE_NATION_SCOTLAND },
  { value: 'Wales', label: 'Wales', role: ROLE_NATION_WALES },
  {
    value: 'NorthernIreland',
    label: 'Northern Ireland',
    role: ROLE_NATION_NORTHERN_IRELAND
  }
]

function viewData(overrides = {}) {
  return {
    roleOptions: ROLE_OPTIONS,
    nationOptions: NATION_OPTIONS,
    ...overrides
  }
}

export function stubLoginGetController(_request, h) {
  const entraIdConfigured = !!(
    config.get('auth.azureEntraId.clientId') &&
    config.get('auth.azureEntraId.tenantId')
  )
  return h.view('auth/stub/login', viewData({ entraIdConfigured }))
}

export function stubLoginPostController(request, h) {
  const { role, nation } = request.payload ?? {}

  const roleOption = ROLE_OPTIONS.find((r) => r.value === role)
  if (!roleOption) {
    return h
      .view('auth/stub/login', viewData({ error: 'Please select a role' }))
      .code(400)
  }

  const nationOption = NATION_OPTIONS.find((n) => n.value === (nation ?? ''))
  const nationRole = nationOption?.role ?? null

  const roles = nationRole
    ? [...roleOption.roles, nationRole]
    : [...roleOption.roles]

  const nationSuffix = nationOption?.value ? ` (${nationOption.label})` : ''

  const user = {
    id: `stub-${role}-1`,
    name: `Stub ${roleOption.label} User${nationSuffix}`,
    email: `stub-${role}@stub.example`,
    roles,
    scope: roles
  }

  request.yar.set('user', user)
  return h.redirect('/')
}
