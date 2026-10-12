import { vi } from 'vitest'

import { config } from '#/config/config.js'
import { isAnalyticsEnabled, logAnalyticsMisconfiguration } from './enabled.js'

describe('analytics enablement', () => {
  const original = {
    isEnabled: config.get('analytics.isEnabled'),
    gtmContainerId: config.get('analytics.gtmContainerId')
  }

  function configure({ isEnabled, gtmContainerId }) {
    config.set('analytics.isEnabled', isEnabled)
    config.set('analytics.gtmContainerId', gtmContainerId)
  }

  afterEach(() => {
    configure(original)
  })

  test('is off by default', () => {
    expect(isAnalyticsEnabled()).toBe(false)
  })

  test.each([
    { isEnabled: false, gtmContainerId: '', expected: false },
    { isEnabled: false, gtmContainerId: 'GTM-TEST', expected: false },
    { isEnabled: true, gtmContainerId: '', expected: false },
    { isEnabled: true, gtmContainerId: 'GTM-TEST', expected: true },
    { isEnabled: true, gtmContainerId: 'GTM-M23T3F5D', expected: true },
    { isEnabled: true, gtmContainerId: 'G-PLACEHOLDER', expected: false },
    { isEnabled: true, gtmContainerId: 'gtm-m23t3f5d', expected: false },
    { isEnabled: true, gtmContainerId: 'GTM-X"><script>', expected: false }
  ])(
    'isEnabled=$isEnabled with gtmContainerId="$gtmContainerId" → $expected',
    ({ isEnabled, gtmContainerId, expected }) => {
      configure({ isEnabled, gtmContainerId })
      expect(isAnalyticsEnabled()).toBe(expected)
    }
  )

  describe('logAnalyticsMisconfiguration', () => {
    test.each(['', 'G-PLACEHOLDER'])(
      'logs an error when switched on without a valid container id ("%s")',
      (gtmContainerId) => {
        configure({ isEnabled: true, gtmContainerId })
        const logger = { error: vi.fn() }

        logAnalyticsMisconfiguration(logger)

        expect(logger.error).toHaveBeenCalledTimes(1)
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('ANALYTICS_GTM_CONTAINER_ID is not set')
        )
      }
    )

    test.each([
      { isEnabled: false, gtmContainerId: '' },
      { isEnabled: false, gtmContainerId: 'GTM-TEST' },
      { isEnabled: true, gtmContainerId: 'GTM-TEST' }
    ])(
      'logs nothing for isEnabled=$isEnabled, gtmContainerId="$gtmContainerId"',
      ({ isEnabled, gtmContainerId }) => {
        configure({ isEnabled, gtmContainerId })
        const logger = { error: vi.fn() }

        logAnalyticsMisconfiguration(logger)

        expect(logger.error).not.toHaveBeenCalled()
      }
    )
  })
})
