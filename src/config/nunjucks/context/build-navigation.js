export function buildNavigation(request) {
  return [
    {
      text: 'Work items',
      href: '/work-items',
      current: request?.path === '/work-items'
    },
    {
      text: 'Backend status',
      href: '/backend-status',
      current: request?.path === '/backend-status'
    }
  ]
}
