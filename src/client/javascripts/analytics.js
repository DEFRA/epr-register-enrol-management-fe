// Does what Google Tag Manager's inline snippet does, which the CSP refuses.
// The server only renders the container id for a visitor who has accepted
// analytics cookies, so no id means no consent and nothing loads.
const GTM_LIBRARY = 'https://www.googletagmanager.com/gtm.js'

export function startTagManager() {
  const containerId = document
    .querySelector('meta[name="analytics-gtm-container-id"]')
    ?.getAttribute('content')

  if (!containerId) {
    return
  }

  const src = `${GTM_LIBRARY}?id=${encodeURIComponent(containerId)}`

  if (document.querySelector(`script[src="${src}"]`)) {
    return
  }

  window.dataLayer = window.dataLayer ?? []
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })

  const tag = document.createElement('script')
  tag.async = true
  tag.src = src
  document.head.appendChild(tag)
}

startTagManager()
