import { globSync, readFileSync } from 'node:fs'

// Every page asset must be served from our own origin. Pulling a font,
// stylesheet, script or image from a third party (Google Fonts, a CDN) sends
// each user's IP address to it on every page load, which is a personal-data
// transfer under UK GDPR. Install the asset from npm and let the Vite build
// bundle it instead, the way @fontsource/roboto is.
//
// Plain <a href> links are fine: nothing loads until the user clicks.

const RULES = [
  {
    files: ['src/**/*.njk', 'src/**/*.html'],
    pattern:
      /<(link|script|img|iframe|source|video|audio|embed|object)\b[^>]*\b(src|href|data)\s*=\s*["']?(https?:)?\/\//gi
  },
  {
    files: ['src/**/*.scss', 'src/**/*.css'],
    pattern: /(url\(\s*["']?|@import\s+["'])(https?:)?\/\//gi
  },
  {
    files: ['src/client/**/*.js'],
    pattern:
      /(\bimport\s*\(|\bfrom\s+|\bfetch\s*\(|\.src\s*=)\s*["'`](https?:)?\/\//gi
  }
]

const lineOf = (text, index) => text.slice(0, index).split('\n').length

describe('third-party resources', () => {
  test.each(RULES)('none referenced in $files', ({ files, pattern }) => {
    const offenders = files
      .flatMap((glob) => globSync(glob))
      .filter((file) => !file.endsWith('.test.js'))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8')
        return [...text.matchAll(pattern)].map(
          (match) => `${file}:${lineOf(text, match.index)}`
        )
      })

    expect(offenders).toEqual([])
  })

  test.each([
    [
      'a Google Fonts stylesheet',
      0,
      '<link href="https://fonts.googleapis.com/css2?family=Roboto" rel="stylesheet">'
    ],
    [
      'a protocol-relative script',
      0,
      "<script src='//cdn.example.com/lib.js'></script>"
    ],
    [
      'an @import of a remote stylesheet',
      1,
      '@import "https://fonts.googleapis.com/css2?family=Roboto";'
    ],
    [
      'a remote url() in CSS',
      1,
      'src: url(https://fonts.gstatic.com/roboto.woff2);'
    ],
    [
      'a dynamic import from a CDN',
      2,
      "await import('https://cdn.example.com/lib.js')"
    ]
  ])('catches %s', (_name, rule, sample) => {
    expect(sample).toMatch(new RegExp(RULES[rule].pattern.source, 'i'))
  })

  test.each([
    [
      'a link to an external page',
      0,
      '<a href="https://www.gov.uk/help/cookies">Cookies</a>'
    ],
    [
      'a local stylesheet',
      0,
      '<link href="{{ getAssetPath(\'application.scss\') }}" rel="stylesheet">'
    ],
    [
      'a local font url()',
      1,
      'src: url(./files/roboto-latin-400-normal.woff2);'
    ]
  ])('allows %s', (_name, rule, sample) => {
    expect(sample).not.toMatch(new RegExp(RULES[rule].pattern.source, 'i'))
  })
})
