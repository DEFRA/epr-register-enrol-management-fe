import { load } from 'cheerio'

/** The GOV.UK notification banner component's own class. */
const BANNER_SELECTOR = '.govuk-notification-banner'

/**
 * The class attribute of one rendered notification banner, so an assertion
 * about its modifier is scoped to the banner itself rather than run against
 * the whole page — where `app-notification-banner--error` could be matched by
 * something else entirely (the compiled stylesheet link, say) and keep passing
 * after the banner lost the class.
 *
 * `selector` narrows to one banner on a page that renders several; the default
 * suits a page with exactly one.
 *
 * THROWS when no banner matches, for the same reason `detailRow` does in
 * detail.controller.test.js: a negative assertion scoped to a missing element
 * passes vacuously, so a banner that stopped rendering would read as a pass.
 */
export function bannerClasses(html, selector = BANNER_SELECTOR) {
  const banner = load(html)(selector)

  if (banner.length === 0) {
    throw new Error(
      `No notification banner matching \`${selector}\` in the rendered page — a scoped assertion against it would pass vacuously.`
    )
  }

  return banner.attr('class') ?? ''
}
