import { vi } from 'vitest'

import { config } from '#/config/config.js'
import { isAnalyticsEnabled, logAnalyticsMisconfiguration } from './enabled.js'

describe('analytics enablement', () => {
  const original = {
    isEnabled: config.get('analytics.isEnabled'),
    measurementId: config.get('analytics.measurementId')
  }

  function configure({ isEnabled, measurementId }) {
    config.set('analytics.isEnabled', isEnabled)
    config.set('analytics.measurementId', measurementId)
  }

  afterEach(() => {
    configure(original)
  })

  test('is off by default', () => {
    expect(isAnalyticsEnabled()).toBe(false)
  })

  test.each([
    { isEnabled: false, measurementId: '', expected: false },
    { isEnabled: false, measurementId: 'G-TEST', expected: false },
    { isEnabled: true, measurementId: '', expected: false },
    { isEnabled: true, measurementId: 'G-TEST', expected: true }
  ])(
    'isEnabled=$isEnabled with measurementId="$measurementId" → $expected',
    ({ isEnabled, measurementId, expected }) => {
      configure({ isEnabled, measurementId })
      expect(isAnalyticsEnabled()).toBe(expected)
    }
  )

  describe('logAnalyticsMisconfiguration', () => {
    test('logs an error when switched on without a measurement id', () => {
      configure({ isEnabled: true, measurementId: '' })
      const logger = { error: vi.fn() }

      logAnalyticsMisconfiguration(logger)

      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('ANALYTICS_MEASUREMENT_ID is not set')
      )
    })

    test.each([
      { isEnabled: false, measurementId: '' },
      { isEnabled: false, measurementId: 'G-TEST' },
      { isEnabled: true, measurementId: 'G-TEST' }
    ])(
      'logs nothing for isEnabled=$isEnabled, measurementId="$measurementId"',
      ({ isEnabled, measurementId }) => {
        configure({ isEnabled, measurementId })
        const logger = { error: vi.fn() }

        logAnalyticsMisconfiguration(logger)

        expect(logger.error).not.toHaveBeenCalled()
      }
    )
  })
})
