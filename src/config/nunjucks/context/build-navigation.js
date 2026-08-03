import { ROLE_SUPPORT_READONLY } from '#/server/common/helpers/auth/auth-scopes.js'

export function buildNavigation(request) {
  const roles = request?.auth?.credentials?.roles ?? []
  const isSupportUser = roles.includes(ROLE_SUPPORT_READONLY)

  const items = [
    {
      text: 'Work items',
      href: '/work-items',
      current: request?.path === '/work-items',
      // RA-324 (AC01). Stable hook for the e2e suite. The LINK stays
      // labelled "Work items" even though it lands on the Applications page.
      attributes: { 'data-testid': 'nav-work-items' }
    }
  ]

  // RA-335: the backend-status page is a support-user diagnostic tool, not
  // a general caseworker or public one — only shown once signed in as a
  // support user.
  if (isSupportUser) {
    items.push({
      text: 'Backend status',
      href: '/backend-status',
      current: request?.path === '/backend-status',
      attributes: { 'data-testid': 'nav-backend-status' }
    })
  }

  return items
}
