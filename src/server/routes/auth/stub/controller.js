import { config } from '#/config/config.js'
import {
  ROLE_NATION_ENGLAND,
  ROLE_NATION_NORTHERN_IRELAND,
  ROLE_NATION_SCOTLAND,
  ROLE_NATION_WALES,
  ROLE_STANDARD
} from '#/server/common/helpers/auth/auth-scopes.js'

/**
 * Static directory of stub assignable users. Exported for the assignee-
 * picker so the assign UI has real names to list. RA-323: every caseworker
 * has the same role, so this is just a directory of names — not a set of
 * permission tiers.
 */
export const STUB_USERS = [
  {
    id: 'stub-caseworker-1',
    name: 'Stub Caseworker One',
    email: 'caseworker-1@stub.example',
    roles: [ROLE_STANDARD]
  },
  {
    id: 'stub-caseworker-2',
    name: 'Stub Caseworker Two',
    email: 'caseworker-2@stub.example',
    roles: [ROLE_STANDARD]
  },
  {
    id: 'stub-caseworker-3',
    name: 'Stub Caseworker Three',
    email: 'caseworker-3@stub.example',
    roles: [ROLE_STANDARD]
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
  const { nation } = request.payload ?? {}

  const nationOption = NATION_OPTIONS.find((n) => n.value === (nation ?? ''))
  const nationRole = nationOption?.role ?? null

  const roles = nationRole ? [ROLE_STANDARD, nationRole] : [ROLE_STANDARD]

  const nationSuffix = nationOption?.value ? ` (${nationOption.label})` : ''

  const user = {
    id: 'stub-caseworker-1',
    name: `Stub Caseworker User${nationSuffix}`,
    email: 'stub-caseworker@stub.example',
    roles,
    scope: roles
  }

  request.yar.set('user', user)
  return h.redirect('/work-items')
}
