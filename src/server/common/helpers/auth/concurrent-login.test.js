import { describe, test, expect, beforeEach, vi } from 'vitest'

import {
  markLoginAndNotifyPrevious,
  clearLogin,
  concurrentLoginNoticeExt,
  dismissNotice,
  LOGIN_AT_KEY,
  INFO_KEY,
  NOTICE_DISMISSED_KEY
} from './concurrent-login.js'
import { config } from '#/config/config.js'

function fakeRegistry(initial = new Map()) {
  const store = initial
  return {
    store,
    get: vi.fn(async (k) => store.get(k) ?? null),
    set: vi.fn(async (k, v) => {
      store.set(k, v)
    }),
    drop: vi.fn(async (k) => {
      store.delete(k)
    })
  }
}

function fakeYar(id = 'sess-new') {
  const map = new Map()
  return {
    id,
    get: (k) => (map.has(k) ? map.get(k) : undefined),
    set: vi.fn((k, v) => map.set(k, v)),
    clear: vi.fn((k) => map.delete(k)),
    _map: map
  }
}

function fakeRequest({
  registry,
  yar = fakeYar(),
  userId = 'user-1',
  isAuthenticated = true
} = {}) {
  return {
    yar,
    logger: { warn: vi.fn() },
    server: { app: { activeSessionRegistry: registry } },
    auth: { isAuthenticated, credentials: userId ? { id: userId } : null },
    app: {}
  }
}

const h = { continue: Symbol('continue') }

beforeEach(() => {
  vi.restoreAllMocks()
  config.set('session.concurrentLoginNotice.enabled', true)
})

describe('markLoginAndNotifyPrevious', () => {
  test('stamps loginAt and records this session in the registry', async () => {
    const registry = fakeRegistry()
    const request = fakeRequest({ registry })

    await markLoginAndNotifyPrevious(request, 'user-1')

    expect(request.yar.set).toHaveBeenCalledWith(
      LOGIN_AT_KEY,
      expect.any(Number)
    )
    expect(registry.set).toHaveBeenCalledWith('user-1', {
      lastLoginAt: expect.any(Number),
      lastLoginSessionId: 'sess-new'
    })
    expect(request.yar.get(INFO_KEY)).toBeUndefined()
  })

  test('arms the info flag when another session already existed', async () => {
    const registry = fakeRegistry(
      new Map([
        ['user-1', { lastLoginAt: 1000, lastLoginSessionId: 'sess-old' }]
      ])
    )
    const request = fakeRequest({ registry })

    await markLoginAndNotifyPrevious(request, 'user-1')

    expect(request.yar.get(INFO_KEY)).toEqual({ otherLoginAt: 1000 })
  })

  test('a registry write failure is swallowed and login still stamps', async () => {
    const registry = fakeRegistry()
    registry.set.mockRejectedValueOnce(new Error('redis down'))
    const request = fakeRequest({ registry })

    await expect(
      markLoginAndNotifyPrevious(request, 'user-1')
    ).resolves.toBeUndefined()
    expect(request.yar.set).toHaveBeenCalledWith(
      LOGIN_AT_KEY,
      expect.any(Number)
    )
  })
})

describe('clearLogin', () => {
  test('drops the registry entry', async () => {
    const registry = fakeRegistry(
      new Map([['user-1', { lastLoginAt: 1, lastLoginSessionId: 'x' }]])
    )
    await clearLogin(fakeRequest({ registry }), 'user-1')
    expect(registry.drop).toHaveBeenCalledWith('user-1')
  })

  test('no-op without a registry', async () => {
    await expect(
      clearLogin(fakeRequest({ registry: undefined }), 'user-1')
    ).resolves.toBeUndefined()
  })
})

describe('concurrentLoginNoticeExt', () => {
  test('sets an alert notice when a newer login exists on another session', async () => {
    const registry = fakeRegistry(
      new Map([
        ['user-1', { lastLoginAt: 5000, lastLoginSessionId: 'sess-other' }]
      ])
    )
    const yar = fakeYar('sess-mine')
    yar._map.set(LOGIN_AT_KEY, 1000)
    const request = fakeRequest({ registry, yar })

    const result = await concurrentLoginNoticeExt(request, h)

    expect(result).toBe(h.continue)
    expect(request.app.concurrentLoginNotice).toMatchObject({
      variant: 'alert',
      otherLoginAt: 5000
    })
  })

  test('sets an info notice from the one-shot flag on the new session', async () => {
    const registry = fakeRegistry()
    const yar = fakeYar('sess-mine')
    yar._map.set(LOGIN_AT_KEY, 9000)
    yar._map.set(INFO_KEY, { otherLoginAt: 4000 })
    const request = fakeRequest({ registry, yar })

    await concurrentLoginNoticeExt(request, h)

    expect(request.app.concurrentLoginNotice).toMatchObject({
      variant: 'info',
      otherLoginAt: 4000
    })
  })

  test('no notice when this session is the latest login', async () => {
    const registry = fakeRegistry(
      new Map([
        ['user-1', { lastLoginAt: 5000, lastLoginSessionId: 'sess-mine' }]
      ])
    )
    const yar = fakeYar('sess-mine')
    yar._map.set(LOGIN_AT_KEY, 5000)
    const request = fakeRequest({ registry, yar })

    await concurrentLoginNoticeExt(request, h)

    expect(request.app.concurrentLoginNotice).toBeUndefined()
  })

  test('no notice once dismissed for that login time', async () => {
    const registry = fakeRegistry(
      new Map([
        ['user-1', { lastLoginAt: 5000, lastLoginSessionId: 'sess-other' }]
      ])
    )
    const yar = fakeYar('sess-mine')
    yar._map.set(LOGIN_AT_KEY, 1000)
    yar._map.set(NOTICE_DISMISSED_KEY, 5000)
    const request = fakeRequest({ registry, yar })

    await concurrentLoginNoticeExt(request, h)

    expect(request.app.concurrentLoginNotice).toBeUndefined()
  })

  test('fails open when the registry read throws', async () => {
    const registry = fakeRegistry()
    registry.get.mockRejectedValueOnce(new Error('redis down'))
    const yar = fakeYar('sess-mine')
    yar._map.set(LOGIN_AT_KEY, 1000)
    const request = fakeRequest({ registry, yar })

    const result = await concurrentLoginNoticeExt(request, h)

    expect(result).toBe(h.continue)
    expect(request.app.concurrentLoginNotice).toBeUndefined()
  })

  test('no-op when the feature flag is off', async () => {
    config.set('session.concurrentLoginNotice.enabled', false)
    const registry = fakeRegistry(
      new Map([
        ['user-1', { lastLoginAt: 5000, lastLoginSessionId: 'sess-other' }]
      ])
    )
    const yar = fakeYar('sess-mine')
    yar._map.set(LOGIN_AT_KEY, 1000)
    const request = fakeRequest({ registry, yar })

    await concurrentLoginNoticeExt(request, h)

    expect(request.app.concurrentLoginNotice).toBeUndefined()
  })
})

describe('dismissNotice', () => {
  test('records the dismissal against the latest known login and clears the info flag', async () => {
    const registry = fakeRegistry(
      new Map([
        ['user-1', { lastLoginAt: 7000, lastLoginSessionId: 'sess-other' }]
      ])
    )
    const request = fakeRequest({ registry })

    await dismissNotice(request)

    expect(request.yar.set).toHaveBeenCalledWith(NOTICE_DISMISSED_KEY, 7000)
    expect(request.yar.clear).toHaveBeenCalledWith(INFO_KEY)
  })

  test('never lowers an existing dismissal watermark', async () => {
    const registry = fakeRegistry(
      new Map([
        ['user-1', { lastLoginAt: 3000, lastLoginSessionId: 'sess-other' }]
      ])
    )
    const yar = fakeYar()
    yar._map.set(NOTICE_DISMISSED_KEY, 9000)
    const request = fakeRequest({ registry, yar })

    await dismissNotice(request)

    expect(request.yar.set).toHaveBeenCalledWith(NOTICE_DISMISSED_KEY, 9000)
  })
})
