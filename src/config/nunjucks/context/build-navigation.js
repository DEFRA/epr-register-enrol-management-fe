export function buildNavigation(request) {
  return [
    {
      text: 'Home',
      href: '/',
      current: request?.path === '/'
    },
    {
      text: 'About',
      href: '/about',
      current: request?.path === '/about'
    },
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
