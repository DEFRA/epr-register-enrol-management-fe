import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'vitest'
import nunjucks from 'nunjucks'
import { load } from 'cheerio'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const env = nunjucks.configure(
  [
    path.resolve(dirname, '../../../../../node_modules/govuk-frontend/dist/'),
    path.resolve(dirname, '..')
  ],
  { trimBlocks: true, lstripBlocks: true }
)

function render(notice) {
  const out = env.renderString(
    `{%- from "session-notice/macro.njk" import sessionNotice -%}` +
      `{{- sessionNotice(notice, "crumb-x") -}}`,
    { notice }
  )
  return load(out)
}

describe('sessionNotice component', () => {
  test('renders nothing without a notice', () => {
    const $ = render(null)
    expect($('[data-testid="session-notice"]')).toHaveLength(0)
  })

  test('the alert variant is an assertive live region (role="alert")', () => {
    const $ = render({ variant: 'alert', at: '3:13pm on 4 September 2026' })
    expect($('[data-testid="session-notice"]')).toHaveLength(1)
    expect($('.app-session-notice__banner').attr('role')).toBe('alert')
    expect(
      $('.app-session-notice__banner').hasClass('govuk-notification-banner')
    ).toBe(false)
    expect($('[data-testid="session-notice-signout"]')).toHaveLength(1)
  })

  test('the info variant is a polite live region (role="status") — matches the JS-enhanced path', () => {
    const $ = render({ variant: 'info', at: '3:13pm on 4 September 2026' })
    expect($('.app-session-notice__banner').attr('role')).toBe('status')
    expect($('[data-testid="session-notice-signout"]')).toHaveLength(0)
  })

  test('carries the dismiss form with the crumb and no bare button[type=submit]', () => {
    const $ = render({ variant: 'alert', at: 'now' })
    expect(
      $('form.app-session-notice__dismiss input[name="crumb"]').attr('value')
    ).toBe('crumb-x')
    expect($('.app-session-notice button[type="submit"]')).toHaveLength(0)
    expect($('[data-testid="session-notice-dismiss"]')).toHaveLength(1)
  })
})
