export function buildNavigation(request) {
  return [
    {
      text: 'Work items',
      href: '/work-items',
      current: request?.path === '/work-items',
      // RA-324 (AC01). Stable hook for the e2e suite. The LINK stays
      // labelled "Work items" even though it lands on the Applications page.
      attributes: { 'data-testid': 'nav-work-items' }
    },
    {
      text: 'Backend status',
      href: '/backend-status',
      current: request?.path === '/backend-status',
      attributes: { 'data-testid': 'nav-backend-status' }
    }
  ]
}
