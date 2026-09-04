import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.js'],
      exclude: [
        ...configDefaults.exclude,
        '.public',
        'coverage',
        'postcss.config.js',
        'stylelint.config.js',
        'vitest.config.js',
        '.sonarlint',
        'babel.config.cjs',
        // Client-side progressive-enhancement scripts: exercised by the WDIO
        // journey suite (epr-register-enrol-mgmt-tests), not by unit tests —
        // this repo has no jsdom test setup.
        'src/client/**'
      ],
      // Baseline as measured on 2026-08-13 (RA-437), raised on 2026-08-18
      // (RA-437 follow-up) after adding coverage for auth-plugin.js,
      // router.js and the re-accreditation decision service — fails the
      // build on regression. Raise these as coverage improves; do not
      // lower without a reason.
      thresholds: {
        statements: 96,
        branches: 91,
        functions: 96,
        lines: 97
      }
    }
  }
})
